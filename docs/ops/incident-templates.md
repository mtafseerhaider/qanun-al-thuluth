# Incident templates

> **Story:** S7-11 · **Related:** `16-security-architecture.md` §17 (severity, breach notification), `19-deployment-architecture.md` §10.4 and §13, `launch-runbook.md` §7

Copy the template you need. Never paste user data (emails, names, health values, chat text) into an incident channel, status page or incident note. Use counts, hashed ids or `request_id`s.

## 1. Declaration (post in the on-call channel)

```text
INCIDENT <YYYY-MM-DD>-<short-title>   SEV<1|2|3>   declared <HH:MM PKT> by <name>
Impact: <who and what is affected, e.g. "push reminders not sent since 04:10, all users">
Detected by: <alert id (E1, M1, kpi_notification_on_time_low...) | user report>
Incident lead: <name>   Comms: <name or same>
Current action: <e.g. "pausing OTA rollout", "maintenance flag on">
Next update: <HH:MM PKT> (every 30 min for SEV1, 60 min for SEV2)
```

## 2. Status page updates

| Stage | Text (en) | Text (ur, pending native review) |
|---|---|---|
| Investigating | We are looking into a problem with {component}. Your data is safe. We will update here within 30 minutes. | ہم {component} میں ایک مسئلے کی جانچ کر رہے ہیں۔ آپ کا ڈیٹا محفوظ ہے۔ ہم 30 منٹ میں یہاں اپ ڈیٹ دیں گے۔ |
| Identified | We found the cause of the problem with {component} and are fixing it. | ہمیں {component} کے مسئلے کی وجہ مل گئی ہے اور ہم اسے ٹھیک کر رہے ہیں۔ |
| Monitoring | A fix is in place for {component}. We are watching to make sure it holds. | {component} کے لیے حل نافذ کر دیا گیا ہے۔ ہم نگرانی کر رہے ہیں۔ |
| Resolved | {component} is working normally again. We are sorry for the trouble. | {component} دوبارہ معمول کے مطابق کام کر رہا ہے۔ تکلیف کے لیے معذرت۔ |

Components: "App and sync", "AI assistant", "Notifications".

## 3. Incident note (`docs/incidents/YYYY-MM-DD-title.md`, within 5 working days, blameless)

```markdown
# <YYYY-MM-DD> <title>

| | |
|---|---|
| Severity | SEV<n> |
| Duration | <start> to <end> PKT (<minutes>) |
| Impact | <users or households affected (count), features, data impact: none / delayed / lost> |
| Detection | <alert or report>, time to detect <min> |
| Resolution | <rollback / fix / flag>, time to mitigate <min> |
| Personal data involved | no / yes: see breach assessment |

## Timeline (PKT)
- HH:MM <event>

## What happened
<plain account; technical cause>

## Why it was not caught earlier
<tests, alerts, review>

## What went well / what was hard

## Actions
| Action | Owner | Due | Issue |
|---|---|---|---|
```

## 4. Personal data breach assessment (SEV1 with S2 or S3 data; 16 §17.2)

```text
Breach assessment   incident <id>   assessed <date/time> by <name>
Became aware at: <timestamp>   72-hour regulator deadline: <timestamp + 72 h>
Data categories: <account / health (S3) / child data / payment status>   Records (est.): <n>   Users (est.): <n>
Jurisdictions: <PK / UK / EU / US>   Cross-tenant? <y/n>
Contained? <y/n, how>   Keys rotated: <list>
Risk to individuals: <none / risk / high risk>, reasoning: <...>
Notify regulator (UK ICO / EU lead SA)? <y/n, by when>   Notify users? <y/n>   Stores? <y/n>
Counsel consulted: <name, time>
```

## 5. Rollback record (append to the incident note)

```text
Rollback: <republish-ota | pin-channel | redeploy-functions | PITR | flag>
Workflow run: <link to rollback-prod.yml run>   Approved by: <name>
From: <update group / tag / timestamp>   To: <...>
Verified by: <health ok, Sentry M1 recovered, KPI ...>
```
