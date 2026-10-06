# On-call rota (template)

> **Story:** S7-11 · **Owner:** PO fills in names and phone routing; lead keeps the agent lanes current · **Related:** `launch-runbook.md` §1 and §7, `sentry-alerts.md`, `incident-templates.md`

The team is one human (the PO) plus Claude Code agents. Agents cannot be paged and do not hold production credentials. The PO is therefore always the **escalation point and the only approver**. Agents are "on call" in the sense that a session is opened for them, with the alert pasted in. They prepare the fix, rollback command or PR, and the PO approves it.

## 1. Rota

Copy this table into the S7 sprint issue each week. Primary is the human who receives pages. The secondary is a trusted backup with read access to dashboards and the status page, if one is appointed. Agent lanes say which agent to open first.

| Week (Mon to Sun) | Primary (pager) | Secondary | Backend agent | Mobile agent | AI agent | Notes |
|---|---|---|---|---|---|---|
| 25 Jan to 31 Jan 2027 (launch prep) | Tafseer | _name_ | backend-lane | mobile-lane | ai-lane | go/no-go 29 Jan |
| 1 Feb to 7 Feb 2027 (launch week) | Tafseer | _name_ | backend-lane | mobile-lane | ai-lane | Ramadan expected ~8 Feb |
| 8 Feb to 14 Feb 2027 (Ramadan week 1) | Tafseer | _name_ | | | | suhoor and iftar watch |
| … | | | | | | |

## 2. Hours and expectations

| Window (PKT) | Coverage | Acknowledge |
|---|---|---|
| 08:00 to 23:00 | primary reachable by phone | SEV1 15 min, SEV2 30 min |
| 23:00 to 08:00 | SEV1 pages only (uptime E1, crash-free M1 critical) | SEV1 30 min |
| Ramadan suhoor (about 03:30 to 05:30) and iftar (17:00 to 20:00) | primary watches push on-time for the first 7 days | n/a |

## 3. Channels

| Purpose | Channel | Set up by |
|---|---|---|
| Pages (SEV1) | uptime monitor phone call or SMS to the primary | PO, in the Better Stack on-call settings |
| Alerts (SEV2 and SEV3) | WhatsApp or Slack group "Thuluth on-call" (Sentry, uptime, log-drain alerts) | PO |
| Status | `status.thuluth.app` | PO |
| Users | `support@thuluth.app`, store reviews | PO |
| Security reports | `security@thuluth.app` (16 §17.2) | PO |

## 4. Handover checklist (end of each shift or week)

- [ ] Open incidents and their next step
- [ ] Rollouts in progress (OTA %, Android staged %, iOS phased day)
- [ ] Flags changed this shift, and why
- [ ] KPI tile (`v_admin_launch_kpis`), anything amber or red
- [ ] Anything the next shift must not do (for example "do not advance Android until the fix in PR #…")

## 5. Opening an agent on an alert

Paste this into a new Claude Code session on the repo:

```text
On-call: <alert name> fired at <time PKT>. Severity <SEV>. Evidence: <link or pasted log lines, no user data>.
Read docs/ops/launch-runbook.md and docs/ops/sentry-alerts.md. Propose the next step and the exact
rollback or fix command. Do not run anything against production; I will approve it.
```
