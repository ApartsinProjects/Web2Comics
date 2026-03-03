import argparse
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from pywinauto import Application


def wait_for(predicate, timeout=30.0, interval=0.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return False


def collect_texts(window):
    texts = []
    try:
        for el in window.descendants():
            txt = (el.window_text() or "").strip()
            if txt:
                texts.append(txt)
    except Exception:
        pass
    return texts


def main():
    parser = argparse.ArgumentParser(description="Simple pywinauto smoke E2E for Web2Comics extension loading.")
    parser.add_argument("--chrome", default=r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe")
    parser.add_argument("--extension-dir", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--timeout", type=int, default=40)
    parser.add_argument("--dump-ui-texts", action="store_true")
    args = parser.parse_args()

    chrome_path = Path(args.chrome)
    ext_dir = Path(args.extension_dir).resolve()
    manifest = ext_dir / "manifest.json"

    if not chrome_path.exists():
        print(f"FAIL: Chrome not found at {chrome_path}")
        return 2
    if not manifest.exists():
        print(f"FAIL: manifest.json not found under {ext_dir}")
        return 2

    user_data_dir = Path(tempfile.mkdtemp(prefix="web2comics-chrome-profile-"))
    cmd = [
        str(chrome_path),
        f"--user-data-dir={user_data_dir}",
        f"--disable-extensions-except={ext_dir}",
        f"--load-extension={ext_dir}",
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        "chrome://extensions/",
    ]

    proc = None
    try:
        proc = subprocess.Popen(cmd)
        app = Application(backend="uia")
        app.connect(process=proc.pid, timeout=20)
        win = app.top_window()
        win.wait("visible enabled ready", timeout=20)

        def page_is_extensions():
            title = (win.window_text() or "").lower()
            return "extensions" in title

        if not wait_for(page_is_extensions, timeout=args.timeout):
            # Try once more by forcing navigation from the address bar.
            win.type_keys("^l")
            time.sleep(0.3)
            win.type_keys("chrome://extensions/{ENTER}", with_spaces=True)
            if not wait_for(page_is_extensions, timeout=15):
                print("FAIL: Could not confirm Extensions page in Chrome title.")
                return 1

        # Smoke assert: extension appears on extensions page.
        def extension_visible():
            texts = collect_texts(win)
            return any("web2comics" in t.lower() for t in texts)

        if not wait_for(extension_visible, timeout=20):
            if args.dump_ui_texts:
                texts = collect_texts(win)
                print("DEBUG_UI_TEXTS_BEGIN")
                for t in texts[:300]:
                    print(t)
                print("DEBUG_UI_TEXTS_END")
            print("FAIL: Extensions page opened but Web2Comics was not detected in UI text.")
            return 1

        print("PASS: Chrome launched, Extensions page opened, Web2Comics detected.")
        return 0
    except Exception as exc:
        print(f"FAIL: pywinauto smoke test error: {exc}")
        return 1
    finally:
        try:
            if proc and proc.poll() is None:
                proc.terminate()
                time.sleep(1)
        except Exception:
            pass
        shutil.rmtree(user_data_dir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
