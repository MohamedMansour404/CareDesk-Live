# CareDesk Full-System Audit Report

Date: 2026-03-24

## 1) Overall System Evaluation

**Rating: 7.1 / 10**

### Strengths

- Modular backend architecture with clear domain separation and event-driven flow via Nest modules and event listeners.
- Real-time UX is generally coherent (conversation/message updates are wired and cleaned up correctly in client listeners).
- Frontend architecture is solid (React Query + Zustand separation, clear feature components).
- Build health is good for both backend and frontend.

### Weaknesses

- Security hard-stop: default JWT secret fallback remains enabled.
- Integration gaps: backend emits websocket events not consumed by frontend (`conversation:transferred`, `evaluation:new`).
- Reliability gaps under failure modes (queue failure is logged but not surfaced; no DLQ pipeline beyond logging).
- Significant lint/type-safety debt in backend (59 ESLint errors).
- Product maturity gaps in UX resilience (limited error surfacing, no session refresh flow).

---

## 2) Backend Report

### Architecture & Logic

- App wiring and infra setup are coherent in [server/src/app.module.ts](server/src/app.module.ts) and bootstrap behavior is clean in [server/src/main.ts](server/src/main.ts).
- Conversation lifecycle operations are centralized and consistent in [server/src/conversations/conversations.service.ts](server/src/conversations/conversations.service.ts).
- Message lifecycle and async AI/queue handoff are clear in [server/src/messages/listeners/message-event.listeners.ts](server/src/messages/listeners/message-event.listeners.ts).

### Verified Issues (source-backed)

- **High – Default JWT secret fallback**: [server/src/config/configuration.ts](server/src/config/configuration.ts#L12) sets `default_secret` when env is missing.
- **Medium – Inconsistent access control policy shape**: conversation resolve endpoint has no explicit role decorator in [server/src/conversations/conversations.controller.ts](server/src/conversations/conversations.controller.ts#L67), relying on service-layer checks.
- **Medium – Queue failure path is silent to product flow**: failed enqueue is only logged in [server/src/messages/listeners/message-event.listeners.ts](server/src/messages/listeners/message-event.listeners.ts#L168-L191).
- **Medium – No formal DLQ behavior**: queue processor labels failures as “DLQ candidate” without routing in [server/src/queue/processors/message.processor.ts](server/src/queue/processors/message.processor.ts#L97-L105).
- **Medium – Cache invalidation is SCAN-based and best-effort**: [server/src/common/services/cache.service.ts](server/src/common/services/cache.service.ts#L68-L84) can be expensive at scale.
- **Low/Medium – Error handling may over-log internals**: full stack logging in [server/src/common/filters/all-exceptions.filter.ts](server/src/common/filters/all-exceptions.filter.ts).

### Performance & Reliability Notes

- MongoDB pool settings are reasonable in [server/src/app.module.ts](server/src/app.module.ts).
- AI in-memory cache has bounded eviction in [server/src/ai/ai.service.ts](server/src/ai/ai.service.ts#L323-L333), reducing prior leak concerns.
- Redis graceful degradation path exists in [server/src/config/redis.module.ts](server/src/config/redis.module.ts).

### Security Notes

- Authentication and role guard structure is mostly correct in [server/src/auth](server/src/auth) and guard usage across controllers.
- `ai-assist` endpoint is properly role-guarded in [server/src/messages/messages.controller.ts](server/src/messages/messages.controller.ts#L67-L80).
- Biggest security risk remains secret management fallback behavior.

---

## 3) Frontend Report

### Implementation & State

- Good composition and state boundaries: [client/src/components](client/src/components), [client/src/stores/authStore.ts](client/src/stores/authStore.ts), [client/src/stores/chatStore.ts](client/src/stores/chatStore.ts).
- Socket listener cleanup is implemented correctly in both [client/src/components/chat/ChatArea.tsx](client/src/components/chat/ChatArea.tsx#L174-L182) and [client/src/components/layout/ConversationList.tsx](client/src/components/layout/ConversationList.tsx#L73-L79).

### UI/UX & Product Quality

- Visual system is coherent and modern across [client/src/styles/index.css](client/src/styles/index.css), [client/src/styles/auth.css](client/src/styles/auth.css), and [client/src/styles/dashboard.css](client/src/styles/dashboard.css).
- UX gaps remain in explicit error communication and resilience:
  - Limited mutation error surfacing in chat actions in [client/src/components/chat/ChatArea.tsx](client/src/components/chat/ChatArea.tsx).
  - New conversation flow does not prominently expose failures in [client/src/components/chat/NewConversation.tsx](client/src/components/chat/NewConversation.tsx).

### Integration Gaps Affecting UX

- Frontend does not listen for backend-emitted `conversation:transferred` and `evaluation:new` events (see listener coverage in [client/src/components/chat/ChatArea.tsx](client/src/components/chat/ChatArea.tsx#L166-L172) and [client/src/components/layout/ConversationList.tsx](client/src/components/layout/ConversationList.tsx#L68-L72)).

---

## 4) Bugs & Issues List (severity)

### High

- **Default JWT fallback secret** in [server/src/config/configuration.ts](server/src/config/configuration.ts#L12).
- **Realtime contract mismatch**: emitted events without client subscribers (`conversation:transferred`, `evaluation:new`) from [server/src/gateway/events.gateway.ts](server/src/gateway/events.gateway.ts#L312-L332) vs client listeners in [client/src/components/chat/ChatArea.tsx](client/src/components/chat/ChatArea.tsx#L166-L172).

### Medium

- **Queue enqueue failure not surfaced as state transition**, only log in [server/src/messages/listeners/message-event.listeners.ts](server/src/messages/listeners/message-event.listeners.ts#L168-L191).
- **No concrete DLQ/replay flow** in [server/src/queue/processors/message.processor.ts](server/src/queue/processors/message.processor.ts#L97-L105).
- **Best-effort SCAN invalidation may degrade at scale** in [server/src/common/services/cache.service.ts](server/src/common/services/cache.service.ts#L68-L84).
- **Service boundary/auth policy inconsistency** around resolve operation in [server/src/conversations/conversations.controller.ts](server/src/conversations/conversations.controller.ts#L67-L76).
- **Frontend lacks refresh-token/session continuation mechanism** in [client/src/lib/api.ts](client/src/lib/api.ts) and [client/src/stores/authStore.ts](client/src/stores/authStore.ts).

### Low

- **Analytics/API UX fallback quality** is limited in [client/src/components/analytics/AnalyticsDashboard.tsx](client/src/components/analytics/AnalyticsDashboard.tsx).
- **Accessibility polish gaps** (focus/labels consistency) in [client/src/styles/dashboard.css](client/src/styles/dashboard.css) and interactive components.

---

## 5) Edge Case Coverage

### Covered ✅

- Redis optional availability / graceful cache behavior in [server/src/config/redis.module.ts](server/src/config/redis.module.ts) and [server/src/common/services/cache.service.ts](server/src/common/services/cache.service.ts).
- Websocket reconnect path and auth connect behavior in [client/src/lib/socket.ts](client/src/lib/socket.ts).
- Conversation participant check for room join via [server/src/conversations/conversations.service.ts](server/src/conversations/conversations.service.ts#L500-L513).

### Partial ⚠️

- Duplicate requests/events: in-memory dedup helps but is instance-local in [server/src/messages/listeners/message-event.listeners.ts](server/src/messages/listeners/message-event.listeners.ts).
- Queue failure handling exists but no user-visible fallback state.
- Token expiration handling logs user out but no seamless refresh flow.

### Missing ❌

- Explicit frontend handling for transfer/evaluation realtime events.
- End-to-end DLQ replay/inspection workflow.
- Automated retry strategy from UI perspective on transient write failures.

---

## 6) Improvements

### Code Improvements

- Enforce mandatory JWT secret at startup (fail fast on missing env).
- Add explicit event-contract typing shared between backend and frontend.
- Raise type safety: resolve backend lint debt (59 errors) before scale-out.

### Architecture Improvements

- Introduce shared event schema package for websocket event names/payloads.
- Implement formal DLQ with retry/replay endpoint + operator visibility.
- Add structured policy layer for resource ownership checks (controller + service consistency).

### Performance Improvements

- Replace broad invalidation with targeted cache key invalidation where possible.
- Add queue and websocket observability metrics (failed jobs, consumer lag, reconnect rate).

---

## 7) Feature Suggestions (ranked)

1. **Unified Agent Work Queue Intelligence**: SLA timers, transfer prompts, evaluation feedback in real time.
2. **Session Continuity**: refresh-token flow + seamless socket auth refresh.
3. **Conversation Transfer UX**: full frontend support for transfer events with ownership transition UI.
4. **Quality Insights Panel**: consume `evaluation:new` to coach agents per message/conversation.
5. **Operational Reliability Console**: DLQ viewer/retry actions, cache/redis/queue health trend cards.

---

## 8) Final Verdict

CareDesk is **close to production-capable for controlled environments**, but it is **not yet top-tier production-ready** for scale or strict security/compliance contexts.

### What is missing to reach top-tier

- P0 security fix for secret management.
- P0 contract synchronization for real-time events.
- P1 reliability hardening for queue failure and DLQ operations.
- P1 backend type-safety/lint stabilization.
- P1 session continuity and UX resilience improvements.

---

## Verification Appendix

### Commands executed

- Backend lint: `npm run lint` (failed with 59 errors, 4 warnings).
- Backend build: `npm run build` (passed).
- Backend e2e: `npm run test:e2e -- --runInBand` (failed: module resolution issue in Jest with `.js` import path from `app.module.ts`).
- Frontend build: `npm run build` (passed).

### Key evidence files

- [server/src/config/configuration.ts](server/src/config/configuration.ts)
- [server/src/messages/listeners/message-event.listeners.ts](server/src/messages/listeners/message-event.listeners.ts)
- [server/src/queue/processors/message.processor.ts](server/src/queue/processors/message.processor.ts)
- [server/src/gateway/events.gateway.ts](server/src/gateway/events.gateway.ts)
- [client/src/components/chat/ChatArea.tsx](client/src/components/chat/ChatArea.tsx)
- [client/src/components/layout/ConversationList.tsx](client/src/components/layout/ConversationList.tsx)
- [client/src/lib/api.ts](client/src/lib/api.ts)
- [client/src/lib/socket.ts](client/src/lib/socket.ts)
