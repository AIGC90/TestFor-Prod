# FleetOne: handover and test plan

This is the checklist for testing the platform end to end. Each scenario names the screen,
the steps and what you should see. Automated tests already cover the business rules
(`pnpm test`: 87 API tests, 27 web tests). This plan is for the flows a person uses.

## 1. Setup

1. Start the stack as in the README (`pnpm infra:up`, seed Traccar, start the API and web app,
   `pnpm demo` for 60 days of Saudi sample data in SAR, `pnpm simulate` for moving trucks).
2. Log in as `admin@fleet.local` / `admin`.
3. Create test users in **Settings → Users Management** and set each one's *ERP role* in the user form:
   fleet supervisor, workshop manager, technician, storekeeper, accountant, driver, viewer.
4. **Pending Inbox → Rules** tab (administrators): switch on the rules you want to test (fuel indent, job card,
   repair bill, payroll, expense claim, AI actions...). A document over the rule's amount goes
   to the Pending Inbox; below it, it is approved straight away.

Tip: test each role in a separate browser profile so you can approve what another user raised.

## 2. Scenarios

### Live operations
| # | Screen | Steps | Expected |
|---|---|---|---|
| L1 | Dashboard | Open with the simulator running | Counts for moving / idle / stopped / offline add up to the fleet |
| L2 | Map | Click a moving truck | Popup with speed, address, last update; trail updates live |
| L3 | Replay | Pick a truck and today | Route draws; play / pause / speed work |
| L4 | Geofences | Draw a polygon, save, link to a truck | Truck entering it raises a geofence event in Notifications |
| L5 | SOS | `curl "http://localhost:5055/?id=<device uniqueId>&lat=28.61&lon=77.2&speed=20&timestamp=$(date +%s)&alarm=sos"` | Within ~15 s an active SOS appears with location and driver; Respond → Resolve (with "add to incident register") closes it and creates an incident |
| L6 | Dashcam | Pick a vehicle | Without a media server: info message; Alerts tab lists ADAS/DMS alarms |

### Operations & trips
| # | Screen | Steps | Expected |
|---|---|---|---|
| O1 | Customers & Orders | Add an order | Order number `ORD-YYYY-####` |
| O2 | Trips | Create trip for the order, Start | Progress % and ETA from GPS; on reaching the destination geofence the trip turns *Arrived* |
| O3 | Trips | POD → Verify delivery | Trip *Completed*, order *Delivered* |
| O4 | Fuel indents | Raise an indent above the rule amount | Waits in Pending Inbox; approve as supervisor |
| O5 | Loading sheet | Upload a CSV with LR rows | Valid rows become LRs; bad rows listed with reasons |
| O6 | Revenue → Receivables | Add invoice, pick a completed trip | GST split, due date from the customer's credit days; the trip can't be billed twice |
| O7 | Revenue → Receivables | Receive part, then the rest (with TDS) | Status Part paid → Paid; ageing chart updates |
| O8 | FASTag | Add a tag, import a bank statement CSV | Duplicates skipped, balance follows the latest row, tolls show the trip they belong to |
| O9 | Subscriptions | Import trackers, Renew one for 12 months | GST invoice (18%) created; Print opens a printable invoice |

### Inventory
| # | Screen | Steps | Expected |
|---|---|---|---|
| I1 | Opening stock | Enter opening quantities | Stock shows them by store at average cost |
| I2 | Requests → Receive | Request, approve, receive | Stock goes up; serial items create pieces |
| I3 | Movements | Issue more than in stock | Refused: no negative stock |
| I4 | Sales | Sell to a buyer in another state | IGST instead of CGST + SGST |

### Tyres and workshop
| # | Screen | Steps | Expected |
|---|---|---|---|
| T1 | Tyre register | Add two tyres | Status *In store*, tread 16 mm |
| T2 | Tyre map | Pick a vehicle, click an empty position, fit | Tyre appears with km 0; history logs the fit |
| T3 | Tyre map | Inspect with 2.8 mm | Slot turns orange; it appears in NSD alerts |
| T4 | Interchanges | Swap FL and FR | Both move; km carried over |
| W1 | PM schedules | Seed defaults for a truck, then Job card on a due task | Draft job card linked to the PM task |
| W2 | Job cards | Submit, approve, Start, Parts, Complete | Parts leave stock against the vehicle; PM task resets |
| W3 | Repair bills | Add a bill, Files → attach the garage invoice → Read with AI | Suggested amounts shown; Apply fills the bill (needs the AI key) |
| W4 | Driver charges | Charge with 3 instalments, approve | Recovered by payroll (see P3) |

### People and compliance
| # | Screen | Steps | Expected |
|---|---|---|---|
| C1 | Compliance | Add an insurance document expiring in 10 days | Shows under *Expiring soon*; the vehicle matrix flags it |
| C2 | Compliance | Renew it | Old document kept in History; new one *Valid* |
| C3 | Compliance | Files → attach the policy → Read with AI → Fill document details | Number, insurer and dates filled (needs the AI key) |
| S1 | Safety | Report incident, File claim, move it to Settled | Insurance recovered goes up on the KPIs |
| P1 | Driver management | Sync from Traccar, assign a truck | Driver on truck; old driver goes to standby |
| P2 | Driver management → Attendance | Mark a month | Totals per driver; future days locked |
| P3 | Driver management → Payroll | Preview, Run, approve, Pay | Charge instalments deducted and recovered; attendance for that month is then locked |
| F1 | Field staff | Add a person and a collection task, Complete with amount | Collected today and leaderboard update |
| F2 | Field staff → Claims | Claim above the rule | Pending Inbox, then Pay |

### AI (needs `ANTHROPIC_API_KEY`)
| # | Screen | Steps | Expected |
|---|---|---|---|
| A1 | Copilot (✨) | "Which vehicles are offline right now?" | Answer lists the offline trucks; chips show *Live GPS* |
| A2 | Copilot | "Which trucks have PM overdue? Propose job cards for the worst two." | Two proposals `AIA-…` waiting for approval; nothing created yet |
| A3 | Pending Inbox | Approve one proposal as another user | A draft job card appears; AI Ops → Proposed actions shows *Executed* |
| A4 | Copilot as a *driver* user | "What was our profit this month?" | The copilot says it can't see finance data |
| A5 | Copilot | "Stop the engine of DL-01-NT-3369" | It declines: AI cannot send vehicle commands |
| A6 | AI Ops → Alert triage | Triage now | Issues grouped by severity with an Open link and a recommended action |
| A7 | AI Ops → Morning briefing | Write today's briefing | Summary, sections and decisions for today |
| A8 | AI Ops → Usage | After the above | Runs and tokens per feature; cached input above zero on repeat copilot use |

### Access control
| # | Steps | Expected |
|---|---|---|
| R1 | Log in as *viewer* | Can open screens; no Add / Edit buttons |
| R2 | **Admin → Field masks**: hide `aadhar` on driver payroll for supervisors | Supervisor no longer sees Aadhar |
| R3 | Raise a document and try to approve it yourself (non-admin) | Refused: self-approval is blocked |

## 3. What needs real accounts before go-live

| Feature | What to provide | Until then |
|---|---|---|
| AI | `ANTHROPIC_API_KEY` as an environment secret | AI screens show "AI is off" |
| Vahan / ULIP sync | Aggregator URL and key | "Sync Vahan" explains it is not configured; enter documents by hand |
| FASTag | Issuer / aggregator API | Import bank statement CSVs |
| Dashcam video | JT/T 1078 media server and `DASHCAM_STREAM_URL` | Alerts and snapshots only |
| flespi | flespi token and a public host for Traccar port 5149 | Devices connect to Traccar directly |
| Payment gateway for subscriptions | Gateway account | Payments recorded by hand |
| Mobile apps (driver POD, field check-in) | Not built; the APIs exist (`/erp/field/check-in`, trip POD) | Supervisors record on the web |

The Vahan and FASTag adapters expect a simple normalised JSON. They were built from typical
aggregator shapes and need checking against the provider you sign up with.

## 4. Production notes

- Set `SECRET_KEY`, `HOOK_SECRET` and the database password; put the API key in a secret store.
- Traccar must forward events to `<api>/erp/hooks/traccar-event` with header `X-Hook-Secret`
  (see `infra/docker-compose.yml`). SOS and trip arrival depend on it.
- Database migrations run automatically when the API starts.
- Back up both databases: `erp` (ERP data, attachments) and `traccar` (positions, events).
- Attachments are stored in PostgreSQL (8 MB each by default). Move them to object storage if
  volumes grow large.
