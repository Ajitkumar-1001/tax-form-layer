# Workpaper prototype: Miraflores case study

A web-native tax workpaper for the Okafor-Lindqvist 2025 return.

| Hand-in | Where |
|---|---|
| 1. The working workpaper | **https://miraflores-workpaper-seven.vercel.app**. The app is in `frontend/`. |
| 2. Core idea and data model (one page) | [`docs/core-idea.md`](docs/core-idea.md), also at `/about` in the app |
| 3. Errors found and how the design surfaced them | [`docs/errors.md`](docs/errors.md), also live at `/errors` in the app |
| 4. Video walkthrough | _(link)_. Script: [`docs/video-script.md`](docs/video-script.md) |

## Run it locally

```bash
docker run -d --name miraflores-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=workpaper -p 54329:5432 postgres:17-alpine
cd frontend
cat > .env.local <<'EOF'
DATABASE_URL=postgres://postgres:postgres@localhost:54329/workpaper
IDENTITY_SECRET=dev-identity-secret
MASK_SECRET=dev-mask-secret
EOF
pnpm install
pnpm test        # 450+ tests, most of them pinned against the packet
pnpm dev         # http://localhost:3000
```

The schema applies itself on first use.

**Role switcher:** the top-right switcher covers every staff member and both clients. It is a demo identity picker, not authentication, but the server enforces the rules for whoever is selected.

**Fresh copy:** switch to Jo Kimura (firm administrator), then Firm › Fresh copy. This starts an empty log on the same packet.

## Layout

- `data/okafor_lindqvist_2025_packet.json`: the packet as delivered. `frontend/data/` holds a byte-identical copy, pinned by SHA-256.
- `frontend/src/lib/model/`: pure, isomorphic code. It derives claims, runs the checks (`checks/`), and holds the projection (`project.ts`), the rules (`authorize.ts`) and the tax effects (`effects.ts`).
- `frontend/src/lib/server/` and `frontend/src/app/api/`: Postgres append-only act log, masking, reveal logging and the simulated e-file.
- `frontend/src/components/`: the queue, trace, documents/records/compare, filing, client portal, firm, and the act forms.
- `frontend/ARCHITECTURE.md`: the module contract and the rules the server enforces.
- `analysis/`: working files from the error hunt (git-ignored): `oracle.py`, the error-hunt output and the design spec.
