# Product Requirements Document: Solvro - Solution-to-Project Lifecycle Engine

> **📁 ARCHIVED 2026-07-21** — historical record of early-stage intent. Solvro
> is in production; current truth lives in CLAUDE.md (decisions/facts),
> CHANGELOG.md (what shipped), DESIGN.md (design system), and
> CONFIGURATION.md (environment/deployment). Do not treat anything below as a
> current requirement.

---

## ⚠️ Superseded Decisions (May 2026)

The following items in this PRD have been explicitly overridden by product decisions recorded in `CLAUDE.md` (see "Product decisions — May 2026" section). **CLAUDE.md takes precedence** in all conflicts.

- **HTMX is not used.** All references to HTMX in §4 and §6 are void. The frontend is pure React + TanStack Query.
- **Timeline View is cut.** §4.6 (Timeline View) is deferred indefinitely — it duplicates the Gantt at phase level and adds no distinct value for TAMs. Do not implement.
- **Network Diagram is cut.** Never implement a Network Diagram tab — no creation path exists in the product.
- **Daily Review screen is added.** A new top-level `DailyReview.tsx` page replaces the global Tasks sidebar slot. TAMs log cross-project notes here daily. Full spec in CLAUDE.md.
- **Reports screen is a structured export trigger.** §4.7 describes reporting vaguely. The concrete implementation is: pull live project data + customer-facing notes → generate a structured markdown export packet → TAM uses it with external AI. No native AI in Solvro yet.
- **Conceptual DB schema in §6.4 is incomplete.** The real schema includes `Customer`, `Service`, `CustomerService`, `Section`, `Label`, `Comment`, `Risk`, and the incoming `ProjectNote` model. Treat §6.4 as a historical sketch only — consult `schema.prisma` for the source of truth.

---

## 1. Problem Statement
In the Customer Success lifecycle, the transition from "Solution Design" to "Project Implementation" is often marred by manual data entry, information loss, and miscommunication. This results in inefficiencies, delays, and increased costs. Current general-purpose project management tools do not adequately address these specific needs, leading to a gap in the workflow between Solution Architects (SAs) and Technical Account Managers (TAMs).

## 2. Goals & Success Metrics

### Goals
1. **Unified Workflow:** Ensure seamless integration between SA blueprints and TAM operations.
2. **Data Integrity:** Maintain a centralized repository for all technical project requirements.
3. **Cost Optimization:** Decommission paid project management tool subscriptions by June 2026.

### Success Metrics
1. **User Adoption:** Achieve a 90% adoption rate among TAMs and SAs within the first 2 months of deployment.
2. **Data Accuracy:** Reduce data entry errors by 75% within the first 3 months.
3. **Cost Savings:** Achieve a 50% reduction in project management tool subscriptions by the end of 2026.

## 3. User Stories
1. **As a Solution Architect**, I want to be able to export my technical design blueprints directly into Solvro, so that the information is accurately and automatically transferred to the TAM's dashboard.
2. **As a Technical Account Manager**, I want to view and manage my daily tasks and project statuses in a user-friendly dashboard, so that I can efficiently track progress and report on project health.
3. **As a Project Stakeholder**, I want to generate detailed reports from Solvro, so that I can make informed decisions and ensure project success.

## 4. Functional Requirements
1. **Secure SA Ingestion Port:**
   - Develop a REST API/Webhook to securely receive solution payloads from the SA Application.
   - Ensure data is validated and sanitized before storage.

2. **TAM Dashboard:**
   - Build a high-speed web interface using React for daily task management, multiple project management views such as Gantt and Kanban tracking, and reporting.
   - Include features such as task assignment, status updates, and progress tracking.
   - Provide real-time notifications for task deadlines and updates.

3. **Centralized Repository:**
   - Implement a PostgreSQL 15+ database to store all technical project requirements.
   - Ensure data is organized and easily searchable.
   - Provide version control for blueprints and project documents.

4. **Kanban Tracking:**
   - Implement a Kanban board within the TAM Dashboard to visualize project tasks and statuses.
   - Allow TAMs to drag and drop tasks between different stages (e.g., To-Do, In-Progress, Done).
   - Provide filtering and sorting options for tasks.

5. **Gantt View:**
   - Implement a Gantt view within the TAM Dashboard to visualize project task dependencies and schedules over time.
   - Allow TAMs to adjust timelines and milestones dynamically.
   - Provide filtering and sorting options for tasks.

6. ~~**Timeline View** (cut — see Superseded Decisions above)~~

7. **Reporting and Analytics:**
   - Generate a structured per-project export packet (markdown) containing: project identity, health signals, phase breakdown, task signals (overdue/blocked/completed counts), open risks, and customer-facing notes from Daily Review.
   - Output is designed to be pasted into an external AI tool for narrative summarisation — no native AI in Solvro.
   - Allow copy-to-clipboard and `.md` file download.

8. **Daily Review:**
   - New top-level screen for TAMs to log cross-project notes in a single daily session.
   - Each note entry carries a visibility flag: `INTERNAL` or `CUSTOMER_FACING`.
   - Only `CUSTOMER_FACING` notes flow into the export packet.
   - Full spec in CLAUDE.md.

9. **User Management:**
   - Implement role-based access control (RBAC) to manage user roles (e.g., SA, TAM, Project Stakeholder).
   - Provide a user-friendly interface for admin users to manage accounts and permissions.

## 5. Non-Functional Requirements
1. **Performance:**
   - Ensure the system can handle concurrent requests from multiple users without significant latency (sub-200ms API response).
   - Optimize database queries with appropriate indexing to reduce load times.

2. **Security:**
   - Implement industry-standard security practices (e.g., SSL/TLS, secure JWT session management, data encryption at rest and in transit).
   - Conduct regular security audits and penetration testing.

3. **Scalability:**
   - Design the system using a stateless backend architecture to scale horizontally to accommodate increasing user loads.
   - Use Docker and Docker Compose for containerization and easy deployment.

4. **Usability:**
   - Ensure the user interface is intuitive and easy to navigate, adhering to modern UI/UX principles.
   - Conduct user testing to gather feedback and make necessary improvements prior to v1.0 release.

---

## 6. Architecture Design

### 6.1. High-Level System Architecture
Solvro follows a modern 3-tier client-server architecture designed for high scalability, rapid UI updates, and secure data ingestion.

1. **Presentation Layer (Frontend):** A single-page application (SPA) built with **React** and TailwindCSS.
2. **Application Layer (Backend API):** A scalable RESTful API service built with Node.js/Express + Prisma.
   - Handles authentication, RBAC authorization, business logic, report generation, and state management.
   - Contains a dedicated **Secure Ingestion Port** (Webhook receiver) isolated with API key/OAuth2 validation to receive JSON payloads from external SA Applications.
3. **Data Layer (Database):** **PostgreSQL 15+** serving as the centralized source of truth.

### 6.2. Component Interaction & Data Flow
1. **Blueprint Ingestion:** The Solution Architect completes a design in the external SA Tool → SA Tool sends an authenticated `POST` webhook payload to the Solvro Ingestion API → backend validates, sanitizes, translates blueprint into project tasks, writes to PostgreSQL.
2. **Dashboard Interaction:** TAM logs into the web interface → frontend retrieves project data via REST API → task updates trigger async `PUT/PATCH` requests → optional WebSockets/SSE for push notifications.
3. **Daily Review & Export:** TAM logs notes in Daily Review (tagged INTERNAL or CUSTOMER_FACING) → Reports screen assembles live project data + CUSTOMER_FACING notes → structured markdown export generated → TAM uses export with external AI tool → sends summary to customer.

### 6.3. Technology Stack Summary
- **Frontend:** React, TailwindCSS, custom Gantt components, `@dnd-kit/core` for Kanban, `recharts` for charts, TanStack Query for server state.
- **Backend:** Node.js / Express + Prisma ORM, REST APIs.
- **Database:** PostgreSQL 15+ (relational data + JSONB for flexible blueprint storage).
- **Infrastructure:** Docker, Docker Compose. Stateless backend for horizontal scaling.
- **Security:** JWT-based authentication, TLS 1.2+, AES-256 for encrypted data fields.

### 6.4. Conceptual Database Schema (Key Entities)

> ⚠️ This schema is a historical sketch. The real schema has evolved significantly — consult `backend/prisma/schema.prisma` for the source of truth.

- `Users`: id, username, email, role_id, created_at
- `Roles`: id, role_name (SA, TAM, ADMIN, STAKEHOLDER + custom), permissions[]
- `Projects`: id, name, description, sa_id, tam_id, customer_id, status, baselineLockedAt, created_at, updated_at
- `Tasks`: id, project_id, parent_task_id, section_id, blueprint_id, title, description, status, start_date, due_date, baseline_start_date, baseline_due_date, assigned_to
- `Blueprints`: id, project_id, payload (JSONB), version, received_at
- `Risks`: id, project_id, title, description, category, status, probability, impact, created_at
- `ProjectNotes`: id, project_id, author_id, body, visibility (INTERNAL | CUSTOMER_FACING), created_at
- `Customers`: id, name, industry, created_at
- `Sections`: id, project_id, name, color, order
