# Render Bot Docs Index

Bot documentation is split into dedicated documents.

- Deployment: [docs/deployment.md](docs/deployment.md)
- Deployment Runbook: [docs/deployment-runbook.md](docs/deployment-runbook.md)
- R2 Storage: [docs/storage-r2.md](docs/storage-r2.md)
- Testing: [docs/testing.md](docs/testing.md)
- Operations: [docs/operations.md](docs/operations.md)

Primary commands:

```bash
npm run render:deploy:auto -- --branch engine
npm run bot:deploy:auto -- --target render --branch engine --env-only
npm run test:render
npm run test:render:r2-real
```

CI workflows:
- `../.github/workflows/bot-deploy.yml`
- `../.github/workflows/bot-tests.yml`
