# Fleet Platform — Functional Build Specification

Reverse-engineered from a read-only walkthrough of the reference product
(`fleet.oredogps.com`, demo Administrator account) on 29 Oct 2026.
Every menu page (74 routes), every tab, and every "Add / New / Create" form was opened.
Nothing was saved: all non-GET requests were blocked during the scan.

This document describes **what to build** (features, screens, fields, statuses, workflows).
It does not reuse the reference product's code, branding or data — use your own brand,
copy and seed data.

---

## 0. Key findings that shape the build

| Finding | Evidence | Consequence for us |
|---|---|---|
| The GPS core is **Traccar** (open-source, Apache 2.0) | REST API is exactly Traccar's: `/api/devices`, `/api/positions`, `/api/server`, `/api/notifications/types`, `/api/notifications/notificators`, `/api/attributes/computed`, `/api/commands/types`, `/api/reports/*`, `/api/statistics`, `/api/session/token` | Run Traccar server for device protocols, positions, events, geofences, notifications, reports. ~30 of the 74 screens are a re-skin of Traccar's web features. |
| The ERP modules have **no backend** | Trips, Customers, Revenue, Stock, Tyres, Workshop, Compliance, SOS, FASTag, Field Staff, Driver Mgmt etc. make **zero** API calls of their own — only the standard Traccar bootstrap calls. Their data is hard-coded demo data in the single JS bundle. Some pages even have "Reset Data" / "Simulate SOS Trigger" buttons. | These modules are front-end prototypes. We must design and build a real database + API for them (this is the bulk of the work). |
| Frontend is a single-page React app (MUI components, Google Maps tiles) | One bundle `assets/index-*.js`, MUI class names, `tile.googleapis.com` sessions | React + MUI (or similar) SPA. Traccar's own web app (`traccar-web`, React + MUI + MapLibre, Apache 2.0) is a legal starting point. |
| Market: Indian logistics / transport fleets | ₹, GST/HSN/TDS 194C, LR (lorry receipt), E-Way Bill, FASTag/NHAI/NPCI, Vahan, AIS-140, Aadhar, RTO | India-specific compliance & integrations are core requirements, not extras. |

### Recommended architecture

```
                 ┌────────────────────────────── Web SPA (React + MUI, maps) ─────────────────────────────┐
                 │  Live ops & GPS screens            │   ERP screens (trips, stock, tyres, workshop…)   │
                 └───────────────┬────────────────────┴───────────────────────┬──────────────────────────┘
                                 │ REST + WebSocket                            │ REST
                    ┌────────────▼────────────┐                    ┌──────────▼──────────────┐
  GPS devices ────► │ Traccar server          │ ◄── events/webhook │ ERP API service          │
  (TCP/UDP, 200+    │ positions, events,      │ ──────────────────►│ (NestJS / Django / .NET) │
   protocols)       │ geofences, commands,    │   positions/odometer│ RBAC, approvals, GL,    │
                    │ notifications, reports  │                    │ documents, integrations  │
                    └────────────┬────────────┘                    └──────────┬──────────────┘
                                 │                                            │
                          Traccar DB (MySQL/PG)                     ERP DB (PostgreSQL) + object storage (photos, PDFs)
```

* Single sign-on: ERP API validates the Traccar session/token (or both sit behind one auth service).
* ERP consumes Traccar **event forwarding / position forwarding** (webhooks) for odometer, trip progress, geofence arrival (incoming vehicles, e-POD), SOS alarms, NSD km tracking, PM-by-km.
* Background jobs: expiry scans (documents, licences, PM, FASTag low balance), nightly tyre-km refresh, scheduled reports, GL posting.

---

## 1. Global shell

* **Login page**: email, password (show/hide), "Remember me", "Forgot password?", language selector, marketing panel, links to Android/iOS apps, Privacy / Terms / Support.
* **Top bar**: global search ("Search vehicles, drivers or locations…"), **Add Device** shortcut, notification bell with unread count, user avatar (name + role).
* **Sidebar** — 8 groups, 74 entries (see §2–§10 for each).
* Greeting line on dashboard ("Good evening, {name} · {weekday, date}").
* Common list-page pattern: KPI cards → status tabs with counts → search + filter dropdowns → table → row actions → pagination (25/50/100) → Export (Excel/CSV).
* Common form pattern: modal dialog for small records; full page (`/x/new`) for multi-line documents; live "summary/preview" panel beside forms; required fields marked `*`; inline "still needed" validation hints.
* Indian number formatting (₹1,18,500; "₹5.1 L"; "Lakhs"), relative times ("2 days ago").

### Roles (from Document Permissions)
Administrator, Standard User (Traccar), plus ERP roles: **Workshop Manager, Fleet Supervisor, Technician / Lead Mechanic, Driver, Storekeeper / Inventory, Accountant / Finance**.

* **Document Permissions** — choose a role → matrix of document types × actions (view/create/edit/approve/delete).
* **Field Masks** — choose a doctype (Job Card, Repair Bill, Gate Pass, Tyre Register, Driver Charge, Stock Movement) → configure which fields are hidden/read-only/mandatory per role.
* **Pending Inbox** — unified approval queue (see §6.9).

---

## 2. LIVE OPERATIONS & FLEET

### 2.1 Dashboard (`/dashboard`)
Period switch: 7 / 14 / 30 days; "Live map" button; "Updated x ago".

| Widget | Content |
|---|---|
| Status KPI cards (clickable) | Total vehicles (+ online now), Moving, Offline, Stopped, Idle — count and % of fleet |
| Distance travelled | Daily fleet distance bar chart, period total, % vs previous period; toggle to **Fuel graph** |
| Summary strip | Engine hours, Average speed, Maximum speed, Fuel used (L), Events count |
| Fleet status | Donut: moving / offline / stopped / idle |
| Alerts per day | Bar chart of all event types |
| Top vehicles by distance | Horizontal bars; click → vehicle report |
| Alert activity by hour | Heatmap weekday × hour, "busiest" callout |
| Alerts by type | Share of each event type |
| Recent alerts | Latest events (type, vehicle, time) + View all |
| Needs attention | Vehicles not reporting, longest silent first (name, IMEI, last seen) |

Data: Traccar `/api/devices`, `/api/positions`, `/api/reports/summary`, `/api/reports/events`.

### 2.2 Map (`/`)
* Left panel "Fleet Devices (n)" with Online/Offline counts; filter chips **All / Running / Stop / Idle / Inactive** with counts; search by device, vehicle no. or driver.
* Device rows: status, last seen, plate, type, IMEI.
* Map: Google Road/Hybrid/Satellite, LocationIQ, OpenFreeMap layers; marker clustering; direction arrows; live route trails; follow marker; popup (fix time, address, speed, total distance — configurable in Preferences).

### 2.3 Route Replay (`/replay`)
Filters: Device, Group, Period (date range), Type. Show → animated playback of track on map with speed, play/pause/scrub. Links to other report types.

### 2.4 Dashcam Streams (`/dashcam`)
* Vehicle list with All / Online / Offline counts, search.
* Per vehicle: driver, last seen, lat/lon, speed, distance, power state.
* Views: **Split view / Front cam / Driver cam**; overlay (timestamp, speed, resolution, LIVE/REC).
* Buttons: Recordings (playback of past footage), Alerts (ADAS & DMS incidents), Call driver, Map view, Snapshot.
* Requires a video protocol (e.g. JT/T 1078) media server — Traccar handles only alarms/media events.

### 2.5 SOS Emergency (`/sos`)
* KPIs: Active SOS alarms, Responding / in progress (avg response time), Resolved today.
* Emergency speed-dial panel: 112, NHAI 1033, company control room, ambulance 108 (configurable list).
* Tabs: All incidents / Active / Responding / Resolved; filter by severity; search vehicle, driver, highway.
* Table: Incident ID & time, Vehicle & driver (phone), Trigger type (Hardware panic button, Severe impact/crash sensor, …) with speed + ignition at trigger, Location/highway + GPS, Severity (CRITICAL/HIGH/…), Status (ACTIVE → RESPONDING → RESOLVED), actions View / Resolve.
* Source: Traccar `alarm` events (sos, accident, …) → create incident automatically.

### 2.6 Notifications Center (`/notification`)
* Unified feed; tabs **All / Critical & SOS / Speed & Driving / Geofences / Maintenance / Billing & FASTag**; search.
* Card: title, category badge, message, vehicle, driver + phone, time; Mark read / Unread; Mark all read; Alert rules link.
* Event sources: Traccar events + ERP events (FASTag low balance, licence expiring, PM due, document expiry).

---

## 3. OPERATIONS & TRIPS

### 3.1 Trip Dispatch Hub (`/trips`)
* KPIs: Total trips (+ freight value), On road, Delays/exceptions, Completed & POD, Scheduled (next 48 h).
* Tabs: All / In Transit / Scheduled / Delayed / Completed; search trip, vehicle, driver, customer, route.
* Table: Trip ID + LR no. + Order no.; Customer & cargo (material, tonnes); Vehicle & driver (phone); Origin → destination, distance, corridor/highway; Transit progress % + ETA + exception note; Status; **e-POD** (Pending / Verified); actions.
* **Create Trip** form: Customer*, Vehicle*, Driver*, Driver mobile*, Origin/loading hub*, Destination/unloading hub*, Highway corridor route, Distance (km), ETA (hrs), Cargo material, Weight (t), Freight rate (₹), Driver advance (₹) → "Dispatch Trip".
* Statuses: Scheduled → In Transit → (Delayed/Alert) → Completed; e-POD: Pending → Verified (photo/signature upload).
* Progress/ETA computed from live GPS vs route distance; geofence arrival closes trip.

### 3.2 Customer & Orders (`/customers`)
* KPIs: Corporate clients, Orders in transit, Active orders value, Total receivables due.
* Tabs:
  * **Customer Orders** — Order ID & booked date, Customer & consignee, Route & cargo, Assigned dispatch (vehicle + trip), Order value (₹ + rate basis e.g. ₹/tonne-km or fixed), Transit status, Billing status (Advance received / Pending invoice / Invoiced / Paid).
  * **Client Directory** — customer profile cards (industry, GSTIN, contacts, credit terms).
  * **Tariffs & Rate Contracts** — Shipper, Cargo category, Billing tariff basis, Detention charges, Credit terms, Lifetime freight; minimum assured tonnage.
  * **Complaints & SLA** — Ticket ID, Customer, Issue category, Description, Priority, Status.
* **Book New Order** form.

### 3.3 Revenue & Financials (`/revenue`)
Vehicle filter; period: This month / 30 d / 90 d / 6 mo / FY to date / 12 mo; Export.
* **Overview**: KPIs Revenue, Operating expenses, Net profit, Profit margin (vs target), Revenue per km & cost per km, Fleet utilisation (trips, km), Outstanding receivables (overdue, DSO), Cash collected 30 d (open invoices). Charts: daily revenue/expenses/profit vs target; auto-generated **Key insights**; Expense mix; Profit waterfall; Revenue by weekday; Top customers; Lane profitability table (Lane, Trips, Revenue, ₹/km, Margin).
* **Vehicles**: net profit by vehicle; efficiency scatter; P&L table (Vehicle, Model, Trips, Distance, Revenue, Expenses, Profit, Margin, Utilisation).
* **Customers & routes**: revenue by customer; revenue/km by lane; lane table (Lane, Trips, Loaded km, Revenue, Trip costs, Contribution, Margin).
* **Expenses**: over time; cost per km; diesel price trend; cost by vehicle (Fuel, Tolls, Driver pay, Maintenance, Tyres, Loading & misc, EMI & insurance).
* **Receivables**: ageing buckets; outstanding by customer; open invoices (Invoice, Customer, Lane, Invoice date, Due, Amount, Status).

### 3.4 Fuel Indents (`/fuel-indents`)
* Views: Indents list / Fuel graph. Tabs All / Pending / Approved / Rejected.
* KPIs: Total requisitions, Pending approvals, Approved, Total value ₹. Trend chart Spend ₹ vs Volume L; total dispatched L; avg diesel rate; daily avg spend.
* Table: Indent ID, Vehicle / LR, Driver & mobile, Pump / vendor, Date, Amount, Status, Actions.
* **New Indent**: Vehicle/LR no.*, Driver name*, Vehicle type, Driver mobile*, "Vehicle is equipment (no driver)" toggle; Pump* (or Cash), Date*, Amount ₹*, Rate ₹/L (optional → litres). Live summary; goes for approval.

### 3.5 Loading Sheet (`/loading-sheet`)
Excel-like grid (≈47 columns A…AU), plant filter, date filter, search all columns, Upload/Verify (Excel import with validation), Excel export, "Operations pending" queue.
* Summary: Total LR, Vehicles, Total weight (MT), Own fleet vs Market fleet (trips, %, vehicles).
* Columns: LR No., Loading date, Product, From, To, Consignor, Consignee, PO no., Vehicle no., Charged weight, Qty, Invoice no., Goods value, E-Way bill no. & expiry, Delivery no., GWT INV / GWT FM, DN, GPS no., Coil ID, DA/DO no., STO no., Vehicle type, Driver contact, Vehicle owner name & PAN, Broker name & PAN, Remarks, Placed by, Own/Market, Diesel total, Declaration, RC received, Collection memo received, Consignment value, Total GST, Invoice value.
* **New LR Entry**: Plant/loading siding*, LR no.*, Vehicle/trailer*, Fleet category* (Own/Market), Product, Charged weight, Consignor, Consignee, Loading date, From, To, Driver contact, E-Way bill no., Invoice no.

### 3.6 Material Received (`/material-received`)
Receive returns from vehicles into a plant store. Tabs: Record receive (form) / Received history / Plant store stock; Bulk received.
Form: Return condition (good/damaged…), Plant*, Date, Vehicle*, LR no., Indent no., "GPS tracker received back" + GPS device issued to this vehicle, Returned items (name, qty, unit, condition), Notes, Proof photo (camera/upload). → creates stock movement.

### 3.7 LR Register (`/lr-register`)
Lorry receipts over loading-sheet rows. Find by LR no.; filters From/To, quick ranges (Today/7 d/30 d/This month), Vehicle, Freight type, Status; master–detail layout; Bulk entry → loading sheet.
**New LR**: LR number*, Date (IST), Initial status (Generated…), Vehicle*, Driver name/phone, Freight type, Transporter/carrier, Origin, Destination, Material, Weight MT, Rate ₹/MT, Advance ₹, E-Way bill no., Remarks. Printable LR.

### 3.8 Freight Memos (`/freight-memos`)
Hire contracts with market vehicles/brokers over attached LRs. Filters: date, vehicle, broker, quick ranges.
Card: Memo no., status (Issued / Loaded / In Transit / Settled), date, vehicle, broker, route, Total freight, Advance, Balance due. Detail: contract freight + rate basis, advance + mode, commission/TDS, balance "payable upon unloading", vehicle/driver, broker contacts, linked LRs.
**New Freight Memo**: Memo no., date, status, Vehicle*, Driver name/phone, Broker/market vendor*, Broker contact, Origin, Destination, Material, Weight MT, Rate basis (Fixed lump sum / Per MT), Rate, Total freight*, Advance paid + mode (Bank transfer/Cash/…), Commission/brokerage, Attached LRs, Remarks.

### 3.9 Incoming Vehicles (`/incoming-vehicles`)
Vehicles dispatched toward your plants (oldest first). Filter plant; search.
Table: Vehicle, Destination plant, Vendor/shipper, Driver + phone, DO/LR no., Commodity + weight, Sent at, Status (In Transit → Approaching → At Gate → Arrived), action **Receive**.
**Add Incoming Vehicle**: Vehicle*, Destination plant*, Vendor, DO/LR no., Driver name/phone, Material, Weight MT, Status. Auto-status from GPS geofence when the vehicle is tracked.

### 3.10 FASTag & Tolls (`/fastrack`)
KPIs: Total wallet balance (tags), Toll expenses recorded (crossings), Low-balance tags, ETC gateway status.
* **Toll Transactions**: Txn ref / NPCI ref, Vehicle + tag, Plaza & highway + lane, Date/time, Amount debited + post-balance, Status (Debited / Low balance), Slip.
* **Tag Accounts & Balances**: Vehicle, FASTag RFID/serial, Issuing bank, Vehicle class, Balance, Status, Actions (recharge).
* Link New FASTag. Integration: bank/NPCI FASTag aggregator API.

### 3.11 Subscriptions & Licenses (`/subscription`)
Account plan card; KPIs: subscribed trackers, expiring in 30 days, M2M SIMs, billing status.
* **Device Licenses**: Vehicle + licence ID, IMEI + SIM operator, Plan type, Expiry (+activated), Days left, Status (Active / Expiring soon / Expired), Renew.
* **Plans & Pricing**: plan cards (Standard Telematics, AIS-140 certified, AI Dashcam + telematics…).
* **GST Invoices**: Invoice ID, Date, Description, Net + 18% GST, Total, Payment method, download.
* **Add Device License**: Vehicle reg*, IMEI (15 digits)*, Plan, M2M operator.

---

## 4. INVENTORY & STORE

Core rule (from UI copy): **"Every change of stock is a Movement. Nothing changes stock any other way."**

### 4.1 Stock (`/stock`)
* Header counts of tagged (serial) pieces: In stock, Damaged, In transit, Issued out, Written off ("issued pieces are still owned").
* Stores list (name, location, on-shelf / total held) + **Add store** (Store name*, Location/plant, Store code).
* Per store: Receive here, Counts (stock-take), Pieces (serial list), Movements; category tree (expand/collapse) with item, part no., state, qty, unit.
* Links: Receive, Count, Movements, GL integration.

### 4.2 Stock Movements (`/movements`)
Filters: Kind, Status, Store, LR number, search.
Table: Time, Kind, Item & part no., Store, Qty + unit, Vehicle / LR, Document ref (ISS-/GRN-/TRF-/AUD-/SCR-), Status.
Kinds: **Receipt, Issue to Vehicle, Plant Transfer, Count Adjustment, Write-off**. Statuses: Completed, In Transit, Pending Approval.
**New movement**: Kind*, Store*, Item*, Part no./SKU, Qty, Unit, Status, Vehicle (if issuing), LR/ref, Remarks.

### 4.3 Stock Requests (`/requests`)
Kinds: **Buy** (procurement) / **Send me stock** (inter-store). Statuses: Open → Approved → In Procurement / Fulfilled → Done.
Table: Request ID + requester, Kind, Target store, Items, Needed by, Notes, Status, Action (Approve / Fulfill / Done).
**New request**: Kind, For store, Needed by, lines (Category, Qty, Note), Notes. Receipts/transfers that reference a request tick it off.

### 4.4 Goods to Receive (`/receive`)
GRN against PO. Store filter tabs; search receipt, supplier, LR.
Table: Receipt + PO + LR, Supplier + city, Destination store, Items expected, Arrived units (x / y), Status (Ready to land / Landed), **Approve & Land**. "Bills unlock upon verified landing" (3-way match).

### 4.5 Item Master (`/item-master`)
* 4-level category hierarchy (main › sub › sub-sub › sub-sub-sub); stock lives on the last level; settings inherit downward. Template download.
* KPIs: main categories, items, tagged pieces, on hand, stock value, attention (reorder).
* Category chips with counts; filters All / Tagged pieces / GPS / Dashcam / Below reorder; search name, code, HSN.
* Table: Item (+ path), Code, **Counting mode** (Standard qty / Serial-tracked / Volume), On hand (good • damaged), Value, Unit, Rate, GST %, HSN, Reorder level, Inspect.

### 4.6 Opening Stock (`/opening-stock`)
Manual entry or spreadsheet import. Target store*, Batch ID (optional, idempotent re-posting), lines (Item category*, Qty, Rate ₹, Serial numbers comma-separated for tracked items). Posted batches table (Batch, Store, Date, Items, Qty, Value, Status).

### 4.7 Stock Sales (`/sales`)
Scrap tyres / surplus spares sold to outside parties. KPIs: realised value, scrapped tyres disposed, invoices, buyers.
Table: Invoice #, Date, Buyer + note, Origin store, Items sold, Taxable, Total incl. GST, Status (Invoiced / Dispatched / Paid).
**New sale** (`/sales/new`): Party*, Store*, Remarks, lines (Category, Piece (serial), Qty, Rate, GST %, Amount); Taxable, GST, Total — server computes CGST/SGST/IGST split and rounding.

### 4.8 Group Loans (`/group-loans`)
Tyres lent to / borrowed from sister companies. Direction tabs; status filters Active / Overdue / Returned.
Table: Loan ref, Tyre serial & spec, Sister company + note, Location/fitment, Loan date, Expected return, Challan #, Status, Mark returned.
**Record Loan**: Direction, Sister company*, Tyre serial*, Size/brand*, Loan date, Expected return, Store or fitment, Challan/gate pass #, Remarks.

### 4.9 Inventory GL Settings (`/inventory-gl-settings`)
Toggle "Post stock movements to General Ledger" (balanced voucher per receipt/issue/transfer). Backfill historical movements from date (skip already-posted) with **Dry run** check.

---

## 5. TYRE MANAGEMENT

Positions: steer FL/FR; drive duals RLO/RLI/RRI/RRO (or D1LO, D1RI, D2RO… for multi-axle); SPARE. NSD thresholds: legal 1.6 mm, preventive 3.0 mm (configurable); colour bands > 7 mm good, 4–7 moderate, < 4 critical. Tyre km = closed km + GPS km since fitment (refreshed nightly).

### 5.1 Tyre Overview (`/tyre-management`)
Tabs: Overview / Vehicle tyre map / Inventory / Cost & lifecycle / Alerts; Tyre tools; Export register.
* KPIs: Tyres in service, Avg tread depth, Need replacement (+ on watch), Tyre cost/km (90 d), Spend this month, Low pressure, Tyres in stock (value, below minimum), Open alerts.
* Charts: health by tread condition, tread-depth distribution, monthly spend (new / repairs / retreads), replacement forecast (30/60 d) table (Vehicle, Position, Tyre, Tread, Replace by, Cost), trucks needing attention, best value by pattern (Pattern, Tyres, Wear mm/1000 km, Projected life, ₹/km).
* Inventory: tyre stock (Brand, Size, Type, In stock, Minimum, Status, Unit price, Value), value by brand, **At the retreader** (From vehicle, Position, Casing, Brand, Sent, Due back).
* Cost & lifecycle: distance vs tread; cost by vehicle; register (Vehicle, Pos., Serial, Tyre, Fitted, Km run, Tread, Pressure, ₹/km, Status).
* Alerts: Severity, Vehicle, Position, Issue.

### 5.2 Tyre Map & Fitment (`/tyre-map`)
Select vehicle → axle layout diagram; each wheel shows serial, brand, NSD, km run, colour by tread. KPIs: mounted tyres, avg NSD vs factory, critical wear, suggested rotation → Create interchange. Actions per position: fit, remove, inspect (NSD/pressure).

### 5.3 Tyre Register (`/tyre-register`)
Audit trail. Filters: date range, event type. KPIs: total events, fits, removals, NSD inspections.
Events: **Fitment, Removal, NSD Inspection, Interchange/Rotation, Remould/Retread, Scrap, Sale**. Columns: Date/time, Event, Tyre serial & brand, Vehicle & position, Odometer, Recorded NSD, Technician / remarks.

### 5.4 Tyre Interchanges (`/tyre-interchanges`)
"Moves between positions or between vehicles — no stock or ledger impact." Types: Same-vehicle rotation / Cross-vehicle swap.
**New** (`/tyre-interchanges/new`): Vehicle 1*, Vehicle 2 (blank = rotation), Removal date, Km vehicle 1, Remarks; swap helper (source position → target position) → Add swap line; lines list.

### 5.5 NSD Wear Alerts (`/nsd-alerts`)
Threshold input (mm). KPIs: flagged, critical (≤ 1.6), warning (1.6–3.0). Table: Tyre serial & brand/size, Vehicle & position, Recorded NSD / original, Wear status, Km run, Recommended action, Rotate.

### 5.6 Tyre Cost / KM (`/tyre-cost-km`)
Date range. KPIs: vehicles analysed, total spend, total km, fleet CPKM. Table: Vehicle & model, Distance, New tyre spend, Retread/repairs, Total, CPKM, Performance (Excellent/Optimal/Moderate), Tyre map.

### 5.7 Tyre Performance (`/tyre-performance`)
Group by Make / Model / Size; fitted-from/to dates; Export. Columns: Make, Models & sizes, Tracked casings, Avg lifespan km, Avg removal NSD, Avg purchase cost, CPKM, Rating.

---

## 6. WORKSHOP & MAINTENANCE

### 6.1 Workshop Hub (`/workshop`)
Period: Today / 7 d / 30 d / This month / 90 d / Custom; live refresh.
KPIs: Open job cards (in progress / awaiting), Aging > 7 days, PM overdue (+ due in 7 d), Gate passes out (past return date), Owed to garages (unpaid bills), Spend (closed).
Charts: weekly opened vs closed; turnaround & cost (avg turnaround, closed, parts ₹, labour ₹, cancelled, raised); live cards by service type; spend by job type (Own / Market / AMC); costliest vehicles; maintenance due next; open job cards table.

### 6.2 Job Cards (`/job-cards`)
Filters: vehicle, status, search. Table: Job card #, Vehicle, Job type, Service type & symptoms, Driver, Date, Status, Details.
Job types: **Own Workshop / Market Garage / AMC**. Service types: Breakdown repair, Preventive maintenance, Tyre fitment, Brake inspection & overhaul, Electrical work & wiring, Oil & filter service, Suspension/leaf spring repair.
Statuses: (Pending approval) → In Progress → Awaiting Spares → Completed (/Cancelled).
**New** (`/job-cards/new`): Vehicle*, Driver, Job type*, Service type, Store, Service party (in-house or vendor), Inspected by, Running km, PM schedule (per vehicle), Problem description. Detail: parts issued (stock movements), labour, linked gate passes & repair bills, cost totals.

### 6.3 PM Schedules (`/pm-schedules`)
Per vehicle or fleet overview; Seed defaults; New schedule. Km from GPS odometer, days from last service.
KPIs: active, overdue, due in < 1,500 km, healthy. Table: Vehicle, Task & category + code, Interval (every X km or Y days), Last performed (km, date), Next due (km, target date), Due status (Overdue by / Due soon / Due in), → Job card.
**New schedule**: Vehicle*, Task*, Interval km*, Interval days*, Last performed date, Last performed odometer.

### 6.4 Gate Passes (`/gate-passes`)
Material leaving a store. Tabs All / Overdue returns; status filter; search.
Kinds: **Returnable / Plain Transfer / Claim-Warranty**. Statuses: Pending Return → Returned; Overdue.
Table: Pass # & date, Kind, From store, Party/vendor, Vehicle & job card, Items, Expected return, Status, Return.
**New** (`/gate-passes/new`): Kind*, From store*, Party*, Vehicle, Job card, Expected return (datetime), Remark, item lines (Category, Item/piece, Qty, Serials, Reason: machining, retreading, warranty, calibration, reconditioning, scrap).

### 6.5 Repair Bills (`/repair-bills`)
"Market garage bills — GST split and TDS run at submit." Table: Bill # & date, Garage (GST verified), Vehicle & job card, Taxable, GST split (18% = 9% CGST + 9% SGST, or IGST), TDS (1%/2% Sec 194C), Net payable, Status (Pending Audit → Approved → Paid), Pay.
**New**: Garage/vendor*, Vehicle*, Bill date*, Taxable subtotal*, Linked job card, auto statutory calc (GST +, TDS −, Net payable), Work/invoice description.

### 6.6 Maintenance Rules (`/settings/maintenances`) — Traccar
Name, Type (odometer / hours / periodic days), Start, Period. Traccar raises "Maintenance required" events.

### 6.7 Tools Checklists (`/tools-checklists`)
Driver toolkit audit. Types **Handover (Out) / Return (In)**. KPIs: total, handovers, returns.
Table: Checklist # & date, Type, Vehicle, Driver, Tools status (x of 8 present / missing), Inspector, Audit status (All clean / Missing items).
Form: Vehicle*, Driver*, Inspector, Date, checklist of standard tools (hydraulic jack, wheel-nut spanner, tommy bar, warning triangle, lockable tool box, fire extinguisher, first-aid kit, LED torch — configurable), Remarks. Missing items → Driver Charge.

### 6.8 Driver Charges (`/driver-charges`)
Select driver → View charges (debits, deductions, settlements).
**Raise Debit Charge**: Driver, Incident date, Category (Missing tool from checklist, Vehicle damage, Other), Vehicle, Total debit ₹, Ref document/audit #, Description, Recovery plan (one-time / instalments via payroll or trip settlement).

### 6.9 Pending Inbox (`/pending-inbox`)
Tabs: All / Job Cards / Gate Passes / Repair Bills / History. Card: title, doc #, type, priority, vehicle, initiated by (role), time, description, estimated amount; Details / Reject / Approve; **Approve all**. Approval routing per role + amount (configurable).

---

## 7. COMPLIANCE, SAFETY & PERSONNEL

### 7.1 Statutory Compliance (`/compliance`)
KPIs: monitored documents, compliance index %, expiring in 30 d, expired/overdue (vehicles grounded), fully validated.
Tabs All / Expiring soon / Expired / Valid; category filter; search.
Table: Vehicle/driver, Document type (RC, Commercial insurance, National permit Form 48, Fitness, PUC, Driving licence…) + description, Document/policy # + issue date, Issuing authority, Validity & expiry (days remaining / overdue by), Status, Renew.
Actions: Upload document; **Sync Vahan DB** (pull RC/insurance/fitness/PUC via Vahan/ULIP aggregator).

### 7.2 Safety & Incidents (`/safety-incidents`)
KPIs: incident-free days, incidents logged/resolved, insurance recovery ₹, fleet safety rating.
* **Incident Register**: Incident ID & time, Vehicle & driver, Type + narrative, Location/highway, Severity (Major/Minor), Roadside support (RSA provider/status), Insurance claim (# + status/amount), Status.
* **Insurance Claims**: Claim ID, Vehicle, Insurer, Surveyor, Estimated damage, Approved payout, Status.
* **Driver Safety Violations**: ADAS/DMS & telematics violations (overspeed, harsh braking, fatigue…).
* **Report Incident / RSA** form.

### 7.3 Field Staff Ops (`/field-staff`)
Technicians, collection agents, sales executives.
* **Live overview**: KPIs on duty, tasks today, collected today ₹, late check-ins, claims awaiting approval, customer rating, team score, cities covered; map by city with status dots; team status list; today's tasks; tasks through the day; recently completed.
* **Team**: by function, by city, by status; directory (Person, Team, City, Status now, Today, 30-day score, Rating, Phone).
* **Tasks**: task volume, list.
* **Attendance & routes**: daily attendance (Check-in, Check-out, Hours, Visits, Km), route map, 14-day presence grid, distance covered.
* **Expense claims**: by category, by month, top claimants, register (Claim, Staff, Date, Category, Description, Receipt, Amount, Status) with approve/reject.
* **Performance**: visits by person, team comparison, daily visits, leaderboard (Visits, Completion, On time, Rating, Km, Monthly target, Score).
* **Add member**: Full name, Role, Team (Installation…), Base city, Phone. **Assign task**.
* Needs a mobile app for staff check-in, GPS, visit proof, receipts.

### 7.4 Driver Management (`/driver-management`)
Actions: Auto-assign waiting trucks; Export payroll/attendance.
* **Overview**: KPIs drivers on roll (on trucks / standby), on duty today, absent/leave/weekly off, trucks without driver, avg driving/day vs limit (9 h), compliance alerts, payroll this month (net/gross), avg driver score; live duty status (Driving, Loading/unloading, Resting, Halted, Standby, Absent, Weekly off); 30-day attendance chart; top drivers (score, km); score distribution; licence & compliance; today's roster (Driver, Vehicle, Status now, Attendance, Score, Km this month).
* **Drivers & assignment**: assign driver ↔ vehicle (dropdown per row), standby pool, allotment history.
* **Working hours**: Days worked, Avg driving, Total hours, Overtime, Avg rest, Days over limit, 7-day sparkline, Compliance.
* **Attendance**: monthly register grid (1…31) with P/H/L/A codes, totals and rate.
* **Payroll**: salary by driver (Paid days, Trips, Km, Gross, Deductions, Net, Status), cost split, deductions, 6-month trend, salary register.
* Driver score from telematics (speeding, harsh events, idle, fatigue).

### 7.5 Registered Drivers (`/drivers`) — Traccar drivers + KYC
Table: Driver name + ID, Driving licence no., Aadhar no., Contact, Assigned user, Status (Authorized), RFID/iButton link.
**Register driver** (`/settings/driver`): Name*, Driving licence no.*, Aadhar (12 digits), Contact, Assign to user; attributes; live profile card. Driver identification via RFID/iButton = Traccar `uniqueId`.

### 7.6 Users Management (`/settings/users`)
Filters: role (Administrator / Standard user), status (Active / Disabled); search; Bulk upload; Add user.
Table: Name + role, Contact, Email, Admin, Status, Actions.
**Add/Edit account** (4 steps): Account (Name*, Email*, Password*) → Preferences (Phone, Default map, Coordinate format, Speed/Distance/Altitude/Volume units, Timezone, POI layer, Lat/Lon/Zoom) → Permissions (Expiration, Device limit, User limit, admin/readonly flags) → Attributes. Device/group/geofence linking per user (Traccar permissions).

---

## 8. REPORTS & ANALYTICS

### 8.1 Fleet Executive BI (`/fleet-analytics`)
Period selector; Export Excel/CSV. KPIs: utilisation %, revenue/km, cost/km (fuel • toll • misc), net operating margin. Cost-per-km breakdown (fuel, tolls, driver wages/bata, PM workshop, tyre amortisation). Fuel efficiency (fleet avg km/L, best route, total fuel, idling loss %). Corridor table (Route, Trips, Distance, Gross revenue, Operating cost, Net margin, Fuel economy). Vehicle table (Registration, Chassis/model, Distance, Running hours (+idle), Utilisation, Cost/km, Revenue/km).

### 8.2 Reports Hub (`/reports`) and Traccar reports
Hub cards grouped: Fleet & activity (Trips, Stops, Summary, Combined), Tracking (Replay, Positions, Chart), Alerts & zones (Events, Geofences), System (Statistics, Scheduled, Logs, Audit).
Common filters: Device, Group, Period, column chooser; Show; Export (Excel/PDF); "Schedule report".

| Report | Route | Columns |
|---|---|---|
| Combined | `/reports/combined` | Device, Fix time, Type, Data, Status, Actions (+ map) |
| Route & Positions | `/reports/route` | Fix time, Latitude, Longitude, Speed, Address, Actions (+ geofence filter, column picker) |
| Trips | `/reports/trips` | Device, Start time, End time, Distance, Avg speed (+ max speed, duration, driver, addresses) |
| Stops | `/reports/stops` | Device, Start, End, Duration (+ address, engine hours) |
| Summary | `/reports/summary` | Device, Start date, Distance, Avg speed, Max speed, Fuel spent, Odometers, Engine hours |
| Chart | `/reports/chart` | Metric (fuel, speed, battery, sensors…) vs time axis |
| Events | `/reports/events` | Device, Fix time, Type, Address, Data; event-type filter |
| Geofences | `/reports/geofences` | Device, Geofence, Start time, End time |
| Statistics | `/reports/statistics` | Capture time, Active users, Active devices, Messages received/stored, Requests (+ KPIs) |
| Audit | `/reports/audit` | Server time, Account, Action, Object |
| Logs | `/reports/logs` | Identifier, Protocol, Data (live raw device messages) |
| Scheduled | `/reports/scheduled` | Type, Description, Calendar (email delivery) |

---

## 9. SETTINGS & ADMINISTRATION

| Screen | Route | Fields / behaviour |
|---|---|---|
| Devices | `/devices` | List: Name + last seen, IMEI, Sell type (Rent/Sale), Type, Model, Customer, SIM/MDN, Operator, Odometer, Expiry, Group, Address, Users. Export, Bulk upload, Add. |
| Add/Edit device | `/settings/device` | 5-step wizard (or "all sections"): **1 Identity & commercial** — Name*, IMEI*, Sell type (Rent / Sale), Customer. **2 Asset & hardware** — Type (car, bus, bike, cat, dog, crane, truck, tank, JCB, ship, human), Model, Odometer km. **3 SIM** — ICCID, MDN, Operator (Airtel, Jio, Vi, BSNL, MTNL, AT&T, Verizon, T-Mobile, Vodafone, Other). **4 Validity** — Expiry date, Device active. **5 Review**. Side: live card preview, QR pairing code, device photo, custom attributes. |
| Vehicle Groups | `/settings/groups` | Name, parent group (hierarchy), vehicle count, attributes. |
| Geofences | `/geofences` | Draw Circle / Polygon / Line on map, address search, Upload GPX, Name, Description, Calendar; Saved zones list with filter. |
| Alert Notification Rules | `/settings/notifications` | KPIs (active rules, alarms & SOS, geofence triggers, 24/7). Tabs All / SOS & alarms / Geofences / Vehicle status. Rule: **Type** (Command result, Status online/unknown/offline, Device inactive, Queued command sent, Device moving/stopped, Speed limit exceeded, Fuel drop/increase, Geofence entered/exited/crossed, Linked device nearby/away, Moving unaccompanied, Alarm, Ignition on/off, Maintenance required, Driver changed, Media); **Alarms** (SOS, Vibration, Movement, Low speed, Overspeed, Fall down, Low power, Low battery, Fault, Power off/on, Door, Lock/Unlock, Geofence enter/exit, GPS antenna cut, Accident, Tow, Idle, High RPM, Hard acceleration/braking/cornering, Lane change, Driver fatigue, Power cut/restored, Jamming, Temperature, Parking, Bonnet, Foot brake, Fuel leak, Tampering, Removal); **Channels** (Web, Email, Command; add SMS/WhatsApp/Push/Telegram); Test channels; Description; Calendar; All devices; Priority. |
| User Preferences | `/settings/preferences` | Active maps, overlay, popup info fields, show direction, live routes, follow, clustering, show map on selection, device title/detail fields, notification sounds (events/alarms), API token generator with expiry, app/server version info. |
| Automation Calendars | `/settings/calendars` | Name, schedule type (simple from/to with recurrence, or iCal upload). |
| Computed Attributes | `/settings/attributes` | Description*, Attribute, Expression* (JEXL), Type, Priority. |
| Saved Commands | `/settings/commands` | Description, Type (Custom, Engine stop/resume, Position single/periodic/stop, Reboot, Factory reset, Send SMS/USSD, Set SOS number, Set odometer, Set speed limit, Request photo, Start/Stop video, alarms…), Data, Send via SMS. |
| Server Announcements | `/settings/announcement` | Users, Channels, Subject, Message (500 chars), live preview, Send. |
| Server Configuration | `/settings/server` | Default map, POI layer, custom map/overlay; units (coordinate format, timezone, speed, distance, altitude, volume) + force to all users; default location/zoom; permissions (Registration, Read-only, Device read-only, Limit commands, Disable reports, No email change); banner announcement; file upload; attributes (server name, description, primary colour, logo, Google API key, active maps). |
| Pending Inbox / Document Permissions / Field Masks | see §1 and §6.9 | |

---

## 10. ERP data model (new PostgreSQL schema)

Master data: `company`, `plant`, `store`, `vehicle` (link to Traccar `deviceId`, reg no., model, type, ownership own/market, owner name/PAN), `driver_profile` (link Traccar driver; licence, Aadhar, phone, score), `party` (customer / vendor / garage / broker / sister company / buyer; GSTIN, PAN, credit terms), `item_category` (4-level tree, counting mode, unit, GST %, HSN, reorder level), `item`, `piece` (serial-tracked: tyre, GPS unit, battery; state & location), `user_role`, `doc_permission`, `field_mask`.

Transport: `order`, `tariff_contract`, `trip` (status, progress, ETA, e-POD), `lr` (lorry receipt), `loading_sheet_row`, `freight_memo` (+ `freight_memo_lr`), `incoming_vehicle`, `fuel_indent`, `invoice`, `receipt_payment`, `complaint_ticket`, `fastag_account`, `toll_txn`, `device_license`, `subscription_invoice`.

Inventory: `stock_movement` (kind, status, store, item/piece, qty, vehicle, LR, doc ref, gl_voucher_id), `stock_request` (+ lines), `purchase_order`, `goods_receipt` (+ lines), `stock_count`, `opening_batch` (+ lines), `stock_sale` (+ lines), `group_loan`, `material_return` (+ lines, photo), `gl_voucher`.

Tyres: `tyre` (= piece), `tyre_fitment` (vehicle, position, fitted/removed km & date), `tyre_event` (fit, remove, NSD, interchange, retread, scrap, sale), `tyre_interchange` (+ lines), `vehicle_axle_layout`.

Workshop: `job_card` (+ parts, labour), `pm_schedule`, `gate_pass` (+ lines), `repair_bill` (taxable, CGST/SGST/IGST, TDS section & %, net), `tool_checklist` (+ items), `driver_charge` (+ recovery instalments), `approval_request` (doc type, doc id, approver role, status, history).

People & safety: `compliance_document` (subject vehicle/driver, type, number, authority, issue, expiry, file), `incident`, `insurance_claim`, `sos_incident`, `notification` (unified feed, read state), `field_staff`, `field_task`, `staff_attendance`, `expense_claim`, `driver_attendance`, `driver_assignment`, `payroll_run` (+ lines, deductions).

Document numbering series (observed): `TRP-YYYY-####`, `ORD-`, `LR-`, `FM-`, `DO-`, `JC-`, `GP-`, `RB-`, `TC-`, `TI-`, `REQ-`, `REC-`, `PO-`, `GRN-`, `ISS-`, `TRF-`, `AUD-`, `SCR-`, `SALE-`, `LN-LENT-`, `BATCH-`, `INC-`, `CLM-`, `SOS-`, `LIC-`, `PMS-`.

---

## 11. External integrations

| Integration | Used by |
|---|---|
| GPS device protocols (Traccar: Teltonika, Concox, AIS-140 / iTriangle, etc.) | Everything live |
| Video telematics (JT/T 1078 or vendor SDK) + media server | Dashcam, ADAS/DMS |
| Google Maps / LocationIQ / OpenFreeMap tiles, geocoding | Map, geofences, addresses |
| Vahan / ULIP (vehicle RC, insurance, fitness, PUC, permits), Sarathi (DL) | Compliance |
| GST E-Way Bill API (NIC) and GSTIN validation | Loading sheet, LR, sales, repair bills |
| FASTag issuer bank / NPCI aggregator | FASTag & tolls |
| SMS / WhatsApp / Email / Push (FCM) gateways | Alerts, announcements |
| Payment gateway (Razorpay etc.) | Subscriptions & licences |
| Accounting export (Tally / ERP) | GL vouchers, invoices, payroll |
| Mobile apps: driver (POD, checklists, fuel indent), field staff (check-in, tasks, claims) | Trips, field staff, tools |

---

## 12. Suggested delivery phases

1. **Platform & GPS core (≈ 4–6 wks)** — Traccar deployment, auth/SSO, app shell, dashboard, map, replay, all Traccar reports, devices wizard, groups, geofences, alert rules, preferences, calendars, computed attributes, commands, users, drivers, server settings, notifications center.
2. **Masters & RBAC (≈ 2–3 wks)** — plants, stores, parties, item master (4-level), roles, document permissions, field masks, approval engine + pending inbox, numbering series, audit log.
3. **Transport operations (≈ 6–8 wks)** — orders & tariffs, trips (GPS progress/ETA, e-POD), loading sheet (grid + Excel import), LR register, freight memos, incoming vehicles, fuel indents, material received.
4. **Inventory (≈ 4–6 wks)** — movements engine, stock, requests, PO/GRN receive, opening stock, sales, group loans, GL posting & backfill.
5. **Workshop & tyres (≈ 6–8 wks)** — job cards, PM schedules (GPS km), gate passes, repair bills (GST/TDS), tools checklists, driver charges; tyre fitment map, register, interchanges, NSD alerts, CPKM & performance.
6. **Compliance, safety, people (≈ 5–7 wks)** — compliance docs + Vahan sync, incidents & claims, SOS command, driver management (assignment, hours, attendance, payroll), field staff (+ mobile app).
7. **Finance & BI (≈ 3–4 wks)** — revenue & financials, receivables, executive BI, FASTag, subscriptions & GST invoices, scheduled exports.
8. **Video (≈ 3–4 wks, depends on hardware)** — dashcam live/playback, ADAS/DMS alerts.

Estimates assume a small team (3–5 developers) and will change once hardware, integrations and exact business rules are confirmed.

---

## Appendix A — Traccar API endpoints observed

`GET /api/server`, `/api/server/timezones`, `/api/session`, `/api/devices`, `/api/groups`, `/api/drivers`, `/api/geofences`, `/api/maintenance`, `/api/calendars`, `/api/users`, `/api/notifications`, `/api/notifications/types`, `/api/notifications/notificators`, `/api/attributes/computed`, `/api/commands`, `/api/commands/types`, `/api/reports/events`, `/api/reports/summary`, `/api/statistics`; `POST /api/session/token`; WebSocket `/api/socket` for live positions/events.

Device fields: id, name, uniqueId (IMEI), status, lastUpdate, positionId, groupId, calendarId, phone, model, contact, category, disabled, expirationTime, attributes (used for sell type, customer, SIM/ICCID, MDN, operator, odometer…).

## Appendix B — Sidebar map (74 entries)

* **Live operations & fleet**: Dashboard, Map, Route Replay, Dashcam Streams, SOS Emergency, Notifications Center
* **Operations & trips**: Trip Dispatch Hub, Customer & Orders, Revenue & Financials, Fuel Indents, Loading Sheet, Material Received, LR Register, Freight Memos, Incoming Vehicles, FASTag & Tolls, Subscriptions & Licenses
* **Inventory & store**: Stock Inventory, Stock Movements, Stock Requests, Goods to Receive, Item Master, Opening Stock, Stock Sales, Group Loans, Inventory GL Settings
* **Tyre management**: Tyre Overview, Tyre Map & Fitment, Tyre Register, Tyre Interchanges, NSD Wear Alerts, Tyre Cost / KM, Tyre Performance
* **Workshop & maintenance**: Workshop Hub, Job Cards, PM Schedules, Gate Passes, Repair Bills, Maintenance Rules, Tools Checklists, Driver Charges
* **Compliance, safety & personnel**: Statutory Compliance, Safety & Incidents, Field Staff Ops, Driver Management, Registered Drivers, Users Management
* **Reports & analytics**: Fleet Executive BI, Reports Hub, Combined, Route & Positions, Trips, Stops, Summary, Chart Analytics, Events, Geofences, Statistics, Audit Trail, System Logs, Scheduled Reports
* **Settings & administration**: Devices, Vehicle Groups, Geofences, Alert Notification Rules, User Preferences, Automation Calendars, Computed Attributes, Saved Commands, Pending Inbox, Document Permissions, Field Masks, Server Announcements, Server Configuration
