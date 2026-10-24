# SpendSense — PRD

## Original problem
Auto expense tracker for India: Android app reads transaction SMS (12-month backfill + live BroadcastReceiver), parses Indian bank/card/UPI formats, auto-categorizes (learns from manual recategorization), budgets with 70/90/100% pace-aware alerts + weekly summary, income & recurring detection, safe-to-spend, reimbursable flag + CSV export, web dashboard sharing one backend. Email login, encryption at rest, no third-party sharing.

## User choices
- Auto-read SMS in installed Android build (local Expo module) + paste SMS in preview
- In-app alerts + local phone notifications (no server push)

## Architecture
- Backend: FastAPI + MongoDB (`server.py`, `sms_parser.py`). JWT (bcrypt) auth. Fernet encryption of merchant/VPA/account/card/raw SMS; HMAC merchant keys for learned rules.
- Frontend: Expo Router, tabs Home/Activity/Budgets/More + screens transaction/[id], add, review, recurring, alerts, export, sms-setup, login. Web = responsive dashboard (max-width 960).
- Native: `frontend/modules/sms-reader` (Kotlin): readInbox, SmsReceiver posts new financial SMS straight to `/api/sms/ingest` in background, queues offline, shows native notification for returned alerts.

## Implemented (Oct 2026)
- Auth, SMS ingest/parse/dedupe/merge (merchant- or channel-aware), review queue, merchant rules
- Budgets + 70/90/100 alerts with pace, weekly summary alert, recurring missing/still-charging alerts
- Overview: safe-to-spend, breakdown, category chart, budgets, recurring, recent
- Activity search/filters/month nav; tx detail recategorize/reimbursable/note/delete/mark recurring
- Reimbursable CSV export (web download / native share); sample SMS loader
- Tested: 15/15 backend tests + full frontend flows

## Backlog
- P1: verify native SMS module on a real Android build; Play Store SMS-permission declaration
- P1: show parsed details in paste result; weekly summary refresh after new alerts
- P2: split server.py into modules; multi-month trends; split transactions; budget rollover
