import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function buildFacebookFeedHtml() {
  return `
    <main>
      <div role="article" data-pagelet="FeedUnit_1">
        <div data-ad-preview="message">
          First post: city council approved a new transit budget for 2026, allocating 120 million dollars to rail upgrades and bus lanes.
          Officials said construction begins in June and will finish in phases over 18 months.
        </div>
      </div>
      <div role="article" data-pagelet="FeedUnit_2">
        <div data-ad-preview="message">
          Second post: local schools announced a pilot AI tutoring program for grade 9 and 10 students.
          The district expects 4,000 participants and plans a public results report in December.
        </div>
      </div>
    </main>
  `;
}

function buildFacebookPostHtml() {
  return `
    <main>
      <div role="article">
        <div data-ad-preview="message">
          Long-form post: researchers published updated climate projections with regional rainfall changes across five zones.
          The report compares 2010 to 2025 baselines, notes a 14 percent increase in extreme precipitation events,
          and recommends infrastructure adaptation in flood-prone districts.
        </div>
      </div>
    </main>
  `;
}

function buildGenericNewsArticleHtml() {
  return `
    <main role="main">
      <article>
        <h1>Major Policy Shift Announced</h1>
        <p>
          Officials announced a multi-year policy update focused on energy infrastructure, public transport,
          and regional resiliency planning. The proposal includes staged funding milestones and quarterly oversight reviews.
        </p>
        <p>
          Analysts said the plan could influence inflation and employment trends if implementation stays on schedule.
          Early estimates project upgrades across major cities and new reporting requirements for each participating agency.
        </p>
        <p>
          Public hearings are expected next month, with a final vote targeted for late summer.
          The drafting committee said revisions will incorporate public feedback and independent audit findings.
        </p>
      </article>
    </main>
  `;
}

function buildHebrewArticleHtml() {
  return `
    <main role="main" dir="rtl" lang="he">
      <article>
        <h1>הממשלה אישרה תוכנית תחבורה חדשה</h1>
        <p>
          הממשלה הציגה תוכנית רב שנתית לשדרוג תחבורה ציבורית הכוללת הרחבת נתיבי אוטובוס,
          השקעה בתשתיות רכבת ושיפור נגישות בפריפריה. התוכנית כוללת אבני דרך רבעוניות.
        </p>
        <p>
          לפי ההודעה, התקציב הראשוני עומד על מיליארדי שקלים והביצוע יתחיל בחודשים הקרובים
          בשיתוף רשויות מקומיות וגופי תכנון ארציים.
        </p>
        <p>
          גורמים מקצועיים ציינו כי התוכנית נשענת על מדדי ביצוע שקופים, לוחות זמנים מפורטים
          ומנגנון בקרה ציבורי שיפורסם באתר ייעודי אחת לרבעון. בנוסף, יוקם צוות תיאום בין משרדי
          לטיפול בחסמים רגולטוריים ולשיפור חיבוריות בין קווי תחבורה מרכזיים.
        </p>
      </article>
    </main>
  `;
}

function buildChineseArticleHtml() {
  return `
    <main role="main" lang="zh">
      <article>
        <h1>城市发布新型交通升级计划</h1>
        <p>
          市政府今天公布了面向未来三年的交通升级方案，重点包括地铁扩容、公交专用道优化、
          以及智慧信号系统建设，以缓解高峰拥堵并提升通勤效率。
        </p>
        <p>
          方案提出分阶段实施目标和公开评估机制，相关部门将按季度披露进展数据，
          并根据市民反馈调整重点项目安排。
        </p>
        <p>
          专家表示，新方案还将引入跨部门协同平台，用于跟踪建设里程碑、预算执行情况
          和服务质量指标，并在重点线路试点实时客流调度，以便在高峰时段快速响应需求变化。
        </p>
        <p>
          同时，规划文件明确提出将围绕学校、医院和产业园区建设综合换乘节点，
          打通地铁、公交、慢行系统之间的接驳路径，并通过公开数据接口发布线路准点率、
          站点拥挤度和投诉处理时效，确保市民能够持续监督实施效果与服务改进进度。
        </p>
      </article>
    </main>
  `;
}

function buildXFeedHtml() {
  return `
    <main>
      <article data-testid="tweet">
        <div lang="en">
          City officials approved a 10-year clean energy roadmap. The first phase starts in Q3 2026 with grid upgrades,
          battery pilot deployments, and monthly public progress metrics.
        </div>
      </article>
      <article data-testid="tweet">
        <div lang="en">
          Transport agency confirmed two new rapid bus corridors and a revised launch timeline after safety review.
        </div>
      </article>
    </main>
  `;
}

function buildXShortFeedHtml() {
  return `
    <main>
      <article data-testid="tweet">
        <div data-testid="tweetText" lang="en">
          City opens new bike lanes downtown after a six month safety review that tracked intersections,
          near-miss incidents, and emergency response routes. Officials said the rollout will continue in
          two additional districts with monthly public reports.
        </div>
      </article>
      <article data-testid="tweet">
        <div data-testid="tweetText" lang="en">
          Transit team schedules station upgrades for May and June, including accessibility ramps,
          platform lighting, and new service displays. The agency expects shorter delays after launch
          and plans to publish before-and-after performance numbers.
        </div>
      </article>
      <article data-testid="tweet">
        <div data-testid="tweetText" lang="en">
          Officials publish monthly metrics for ridership and delays, and they also added a public dashboard
          with route-level reliability, peak hour crowding, and service recovery timelines so residents can
          verify whether improvement targets are being met.
        </div>
      </article>
    </main>
  `;
}

function buildCnnLikeMultiStoryHtml() {
  return `
    <main role="main">
      <article>
        <h1>Story Alpha: Elections</h1>
        <p>
          Story Alpha reports on election turnout changes across major districts with detailed county-by-county
          comparisons, official statements, and updated timelines for certification.
        </p>
        <p>
          Analysts in Story Alpha cite historical turnout baselines from 2016 through 2024 and explain how
          policy messaging, transport access, and early voting windows influenced participation.
        </p>
      </article>
      <article>
        <h1>Story Beta: Space Launch</h1>
        <p>
          Story Beta covers a commercial launch campaign, engine validation milestones, weather constraints,
          and revised mission windows for payload deployment and orbital insertion.
        </p>
        <p>
          Engineers in Story Beta describe static-fire test data, telemetry checks, and go/no-go criteria used
          before approving the launch timeline and recovery operations.
        </p>
      </article>
    </main>
  `;
}

describe('Content Script Site Adapters', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    try { delete globalThis.__WEB2COMICS_CONTENT_TEST_API__; } catch (_) {}
  });

  afterEach(() => {
    document.documentElement.innerHTML = '<html><head></head><body></body></html>';
    try { delete globalThis.__WEB2COMICS_CONTENT_TEST_API__; } catch (_) {}
  });

  it('activates Facebook adapter candidates on feed-like pages', async () => {
    document.body.innerHTML = buildFacebookFeedHtml();
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    expect(api).toBeTruthy();

    const candidates = api.pickSiteAdapterCandidates();
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.adapterId === 'facebook')).toBe(true);
    expect(candidates.some((c) => c.sourceType === 'social')).toBe(true);
  });

  it('extracts readable full content for Facebook feed/post content', async () => {
    document.body.innerHTML = buildFacebookFeedHtml();
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const result = await api.extractReadableContent('full', {});

    expect(result.success).toBe(true);
    expect(result.mode).toBe('full');
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(140);
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(typeof result.selectedCandidateId).toBe('string');
    expect(typeof result.autoSelectedCandidateId).toBe('string');
    expect(result.selectedCandidateId.length).toBeGreaterThan(0);
    expect(result.autoSelectedCandidateId.length).toBeGreaterThan(0);
    expect(typeof result.candidates[0].summaryMethod).toBe('string');
  });

  it('extracts readable content for Facebook single-post view fallback', async () => {
    document.body.innerHTML = buildFacebookPostHtml();
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const result = await api.extractReadableContent('full', {});

    expect(result.success).toBe(true);
    expect(result.mode).toBe('full');
    expect(result.text).toContain('climate projections');
  });

  it('supports top 10 major news domains with the news adapter', async () => {
    document.body.innerHTML = buildGenericNewsArticleHtml();
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const hosts = [
      'www.cnn.com',
      'www.nytimes.com',
      'www.foxnews.com',
      'www.bbc.com',
      'www.reuters.com',
      'www.washingtonpost.com',
      'www.wsj.com',
      'apnews.com',
      'www.npr.org',
      'www.theguardian.com'
    ];

    for (const host of hosts) {
      const candidates = api.pickSiteAdapterCandidatesForHost(host);
      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.some((c) => c.adapterId === 'news-generic')).toBe(true);
      expect(candidates[0].text.length).toBeGreaterThan(180);
    }
  });

  it('supports top 5 high-traffic English/Hebrew/Chinese hosts', async () => {
    document.body.innerHTML = buildGenericNewsArticleHtml();
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const hostGroups = {
      english: [
        'www.cnn.com',
        'www.bbc.com',
        'www.reuters.com',
        'www.nytimes.com',
        'www.theguardian.com'
      ],
      hebrew: [
        'www.ynet.co.il',
        'www.walla.co.il',
        'www.mako.co.il',
        'www.haaretz.co.il',
        'www.calcalist.co.il'
      ],
      chinese: [
        'news.qq.com',
        'www.163.com',
        'www.sohu.com',
        'www.weibo.com',
        'www.zhihu.com'
      ]
    };

    for (const group of Object.values(hostGroups)) {
      for (const host of group) {
        const candidates = api.pickSiteAdapterCandidatesForHost(host);
        expect(Array.isArray(candidates)).toBe(true);
        expect(candidates.length).toBeGreaterThan(0);
        expect(candidates[0].text.length).toBeGreaterThan(120);
      }
    }
  });

  it('extracts readable full content from Hebrew article text', async () => {
    document.body.innerHTML = buildHebrewArticleHtml();
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const result = await api.extractReadableContent('full', {});
    expect(result.success).toBe(true);
    expect(result.mode).toBe('full');
    expect(result.text).toContain('תוכנית');
  });

  it('extracts readable full content from Chinese article text', async () => {
    document.body.innerHTML = buildChineseArticleHtml();
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const result = await api.extractReadableContent('full', {});
    expect(result.success).toBe(true);
    expect(result.mode).toBe('full');
    expect(result.text).toContain('交通升级方案');
  });

  it('activates X adapter candidates on tweet-like pages', async () => {
    document.body.innerHTML = buildXFeedHtml();
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const candidates = api.pickSiteAdapterCandidatesForHost('x.com');
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.adapterId === 'x')).toBe(true);
    expect(candidates.some((c) => c.sourceType === 'social')).toBe(true);
  });

  it('extracts readable full content from short X posts by combining top tweets', async () => {
    document.body.innerHTML = buildXShortFeedHtml();
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const result = await api.extractReadableContent('full', {});

    expect(result.success).toBe(true);
    expect(result.mode).toBe('full');
    expect(result.text).toContain('City opens new bike lanes');
    expect(result.text).toContain('monthly metrics for ridership');
    expect(result.text.length).toBeGreaterThan(120);
  });

  it('resolves selected story by stable candidate id on cnn-like multi-story pages', async () => {
    document.body.innerHTML = buildCnnLikeMultiStoryHtml();
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const firstPass = await api.extractReadableContent('full', {});
    expect(firstPass.success).toBe(true);
    expect(Array.isArray(firstPass.candidates)).toBe(true);
    expect(firstPass.candidates.length).toBeGreaterThan(1);

    const selectedId = String(firstPass.candidates[1].id || '');
    expect(selectedId.length).toBeGreaterThan(0);
    expect(/^candidate_/i.test(selectedId)).toBe(true);

    const secondPass = await api.extractReadableContent('full', { selectedCandidateId: selectedId });
    expect(secondPass.success).toBe(true);
    expect(secondPass.selectedCandidateId).toBe(selectedId);
    expect(secondPass.text.length).toBeGreaterThan(120);
    expect(secondPass.text).toContain('Story Beta');
  });

  it('prefers active user text selection with selection_auto mode before full extraction', async () => {
    document.body.innerHTML = buildCnnLikeMultiStoryHtml();
    const selected = 'User selected story text '.repeat(16);
    window.getSelection = vi.fn(() => ({ toString: () => selected }));
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const result = await api.extractReadableContent('full', {});

    expect(result.success).toBe(true);
    expect(result.mode).toBe('selection_auto');
    expect(result.text).toContain('User selected story text');
    expect(result.text.length).toBeGreaterThan(220);
  });

  it('falls back to auto-selected candidate when requested candidate id is unknown', async () => {
    document.body.innerHTML = buildCnnLikeMultiStoryHtml();
    window.getSelection = vi.fn(() => ({ toString: () => '' }));
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const result = await api.extractReadableContent('full', { selectedCandidateId: 'candidate_does_not_exist' });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('full');
    expect(typeof result.autoSelectedCandidateId).toBe('string');
    expect(result.autoSelectedCandidateId.length).toBeGreaterThan(0);
    expect(result.selectedCandidateId).toBe(result.autoSelectedCandidateId);
  });

  it('returns fullSourceText and candidatePayloads for multi-story pages', async () => {
    document.body.innerHTML = buildCnnLikeMultiStoryHtml();
    window.getSelection = vi.fn(() => ({ toString: () => '' }));
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const result = await api.extractReadableContent('full', {});

    expect(result.success).toBe(true);
    expect(typeof result.fullSourceText).toBe('string');
    expect(result.fullSourceText).toContain('Story Alpha');
    expect(result.fullSourceText).toContain('Story Beta');
    expect(Array.isArray(result.candidatePayloads)).toBe(true);
    expect(result.candidatePayloads.length).toBeGreaterThan(1);
    expect(result.candidatePayloads.some((p) => p.id === result.selectedCandidateId)).toBe(true);
    expect(result.candidatePayloads.every((p) => typeof p.text === 'string' && p.text.length > 20)).toBe(true);
  });

  it('returns a clear error in explicit selection mode when no text is selected', async () => {
    document.body.innerHTML = buildGenericNewsArticleHtml();
    window.getSelection = vi.fn(() => ({ toString: () => '   ' }));
    await import('../../content/content-script.js');
    await flush();

    const api = globalThis.__WEB2COMICS_CONTENT_TEST_API__;
    const result = await api.extractReadableContent('selection', {});

    expect(result.success).toBe(false);
    expect(result.mode).toBe('selection');
    expect(String(result.error || '')).toContain('No text selected');
  });
});
