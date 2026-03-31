# CareDesk API Documentation

## Overview

This document covers the HTTP API exposed by the CareDesk backend.

Base path: `/api`

Authentication: Bearer JWT in `Authorization` header.

```http
Authorization: Bearer <access_token>
```

Roles used by the API:

- `patient`
- `agent` (specialist)
- `admin`

---

## How to Use the API

1. Register or login to get `accessToken` and `refreshToken`.
2. Send `Authorization: Bearer <accessToken>` for protected routes.
3. Use `/api/auth/refresh` when access token expires.
4. Use conversation and message endpoints based on role:

- patient: create conversations and messages
- specialist (agent): work queue, reply, evaluate, analytics

---

## Auth

### POST /api/auth/register

- Description: Create a patient account and return tokens.
- Auth required: No
- Role required: None

Request body:

```json
{
  "email": "patient@example.com",
  "password": "StrongPass123!",
  "name": "Patient One",
  "specialization": "optional"
}
```

Notes:

- `role` is ignored by service logic and saved as `patient`.

Query params:

- None

Response example:

```json
{
  "user": {
    "_id": "67f0d1f6d1a2b35f8e8e0001",
    "email": "patient@example.com",
    "name": "Patient One",
    "role": "patient",
    "isOnline": false,
    "activeConversations": 0,
    "createdAt": "2026-03-31T08:00:00.000Z",
    "updatedAt": "2026-03-31T08:00:00.000Z"
  },
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>"
}
```

### POST /api/auth/login

- Description: Login and return tokens.
- Auth required: No
- Role required: None

Request body:

```json
{
  "email": "patient@example.com",
  "password": "StrongPass123!"
}
```

Query params:

- None

Response example:

```json
{
  "user": {
    "_id": "67f0d1f6d1a2b35f8e8e0001",
    "email": "patient@example.com",
    "name": "Patient One",
    "role": "patient"
  },
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>"
}
```

### POST /api/auth/refresh

- Description: Issue a new access/refresh token pair.
- Auth required: No
- Role required: None

Request body:

```json
{
  "refreshToken": "<jwt>"
}
```

Query params:

- None

Response example:

```json
{
  "user": {
    "_id": "67f0d1f6d1a2b35f8e8e0001",
    "email": "patient@example.com",
    "name": "Patient One",
    "role": "patient"
  },
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>"
}
```

### POST /api/auth/logout

- Description: Revoke stored refresh token hash for current user.
- Auth required: Yes
- Role required: Any authenticated role

Request body:

- None

Query params:

- None

Response example:

```json
{
  "success": true
}
```

### GET /api/auth/profile

- Description: Get current authenticated user profile.
- Auth required: Yes
- Role required: Any authenticated role

Request body:

- None

Query params:

- None

Response example:

```json
{
  "_id": "67f0d1f6d1a2b35f8e8e0001",
  "email": "patient@example.com",
  "name": "Patient One",
  "role": "patient",
  "isOnline": false,
  "activeConversations": 0,
  "createdAt": "2026-03-31T08:00:00.000Z",
  "updatedAt": "2026-03-31T08:00:00.000Z"
}
```

---

## Conversations

### POST /api/conversations

- Description: Create a conversation.
- Auth required: Yes
- Role required: `patient`

Request body:

```json
{
  "channel": "human",
  "initialMessage": "I have chest discomfort for 2 days",
  "patientName": "Patient One",
  "intake": {
    "version": 1,
    "demographics": {
      "age": 44,
      "gender": "male"
    },
    "vitals": {
      "heightCm": 178,
      "weightKg": 82
    },
    "clinical": {
      "chronicConditions": ["hypertension"],
      "symptomDuration": {
        "value": 2,
        "unit": "days"
      },
      "painScale": 6,
      "mainComplaint": "Persistent chest discomfort and nausea"
    }
  }
}
```

Query params:

- None

Response example:

```json
{
  "_id": "67f0d2b8d1a2b35f8e8e0007",
  "patient": "67f0d1f6d1a2b35f8e8e0001",
  "channel": "human",
  "status": "pending",
  "priority": "high",
  "category": "symptom_report",
  "language": "en",
  "intake": {
    "version": 1,
    "demographics": { "age": 44, "gender": "male" },
    "clinical": {
      "symptomDuration": { "value": 2, "unit": "days" },
      "painScale": 6,
      "mainComplaint": "Persistent chest discomfort and nausea",
      "triage": {
        "level": "high",
        "score": 78,
        "source": "rules_v1",
        "reasons": ["pain scale", "complaint keyword"],
        "classifiedAt": "2026-03-31T08:05:00.000Z"
      }
    }
  },
  "createdAt": "2026-03-31T08:05:00.000Z",
  "updatedAt": "2026-03-31T08:05:00.000Z"
}
```

### GET /api/conversations

- Description: List conversations.
- Auth required: Yes
- Role required:
- `patient`: returns patient conversations
- `agent`/`admin`: returns human queue list

Query params:

- `page` (optional, default `1`)
- `limit` (optional, default `20`, max `100`)

Request body:

- None

Response example:

```json
{
  "data": [
    {
      "_id": "67f0d2b8d1a2b35f8e8e0007",
      "channel": "human",
      "status": "pending",
      "priority": "high"
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

### GET /api/conversations/:id

- Description: Get a single conversation.
- Auth required: Yes
- Role required:
- patient owner
- assigned specialist (agent)
- queue-view specialist when conversation is `human + pending + unassigned`

Request body:

- None

Query params:

- None

Response example:

```json
{
  "_id": "67f0d2b8d1a2b35f8e8e0007",
  "patient": {
    "_id": "67f0d1f6d1a2b35f8e8e0001",
    "name": "Patient One",
    "email": "patient@example.com"
  },
  "agent": {
    "_id": "67f0d300d1a2b35f8e8e0100",
    "name": "Dr. Agent",
    "email": "agent@example.com"
  },
  "channel": "human",
  "status": "assigned",
  "priority": "high"
}
```

### PATCH /api/conversations/:id/assign

- Description: Assign current specialist to pending conversation.
- Auth required: Yes
- Role required: `agent`

Request body:

- None

Query params:

- None

Response example:

```json
{
  "_id": "67f0d2b8d1a2b35f8e8e0007",
  "status": "assigned",
  "agent": "67f0d300d1a2b35f8e8e0100"
}
```

### PATCH /api/conversations/:id/resolve

- Description: Resolve a conversation.
- Auth required: Yes
- Role required: `patient` or `agent` with access

Request body:

- None

Query params:

- None

Response example:

```json
{
  "_id": "67f0d2b8d1a2b35f8e8e0007",
  "status": "resolved",
  "resolvedAt": "2026-03-31T08:20:00.000Z"
}
```

### PATCH /api/conversations/:id/transfer

- Description: Transfer assigned conversation to another specialist.
- Auth required: Yes
- Role required: `agent`

Request body:

```json
{
  "targetAgentId": "67f0d305d1a2b35f8e8e0109",
  "reason": "handoff for specialist domain"
}
```

Query params:

- None

Response example:

```json
{
  "_id": "67f0d2b8d1a2b35f8e8e0007",
  "status": "in_progress",
  "agent": "67f0d305d1a2b35f8e8e0109",
  "handoffHistory": [
    {
      "from": "67f0d300d1a2b35f8e8e0100",
      "to": "67f0d305d1a2b35f8e8e0109",
      "reason": "handoff for specialist domain",
      "at": "2026-03-31T08:25:00.000Z"
    }
  ]
}
```

### PATCH /api/conversations/:id/escalate

- Description: Escalate AI conversation to human queue.
- Auth required: Yes
- Role required: `patient`

Request body:

- None

Query params:

- None

Response example:

```json
{
  "_id": "67f0d2b8d1a2b35f8e8e0007",
  "channel": "human",
  "status": "pending"
}
```

---

## Messages

Base route: `/api/conversations/:conversationId/messages`

### POST /

- Description: Create patient or specialist message based on authenticated role.
- Auth required: Yes
- Role required: patient owner or specialist with access

Request body:

```json
{
  "content": "Patient message or specialist reply"
}
```

Query params:

- None

Response example (patient message):

```json
{
  "message": {
    "_id": "67f0d3f2d1a2b35f8e8e0201",
    "conversation": "67f0d2b8d1a2b35f8e8e0007",
    "sender": "67f0d1f6d1a2b35f8e8e0001",
    "senderRole": "patient",
    "content": "I still feel chest pressure",
    "createdAt": "2026-03-31T08:30:00.000Z"
  },
  "status": "processing",
  "channel": "human"
}
```

Response example (specialist message):

```json
{
  "_id": "67f0d3f2d1a2b35f8e8e0202",
  "conversation": "67f0d2b8d1a2b35f8e8e0007",
  "sender": "67f0d300d1a2b35f8e8e0100",
  "senderRole": "agent",
  "content": "Please share if symptoms worsen",
  "createdAt": "2026-03-31T08:31:00.000Z"
}
```

### GET /

- Description: Paginated messages for a conversation.
- Auth required: Yes
- Role required: patient owner or specialist with access

Query params:

- `page` (optional, default `1`)
- `limit` (optional, default `20`, max `100`)

Request body:

- None

Response example:

```json
{
  "data": [
    {
      "_id": "67f0d3f2d1a2b35f8e8e0201",
      "senderRole": "patient",
      "content": "I still feel chest pressure",
      "analysis": {
        "intent": "symptom_report",
        "priority": "high",
        "sentiment": "distress",
        "confidence": 0.92,
        "shouldEscalate": true
      },
      "createdAt": "2026-03-31T08:30:00.000Z"
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

### GET /ai-assist

- Description: Generate AI assistance for specialist based on conversation history.
- Auth required: Yes
- Role required: `agent` with conversation access

Request body:

- None

Query params:

- None

Response example:

```json
{
  "summary": "Patient reports persistent chest discomfort for 2 days.",
  "keyPoints": ["pain scale reported 6/10", "nausea present"],
  "suggestedReply": "Thanks for sharing this. Can you confirm if pain is worsening or radiating?",
  "relevantContext": "Escalate quickly if severe symptoms increase"
}
```

---

## Evaluations

### GET /api/evaluations/agent/:agentId

- Description: Get specialist evaluation list and average stats.
- Auth required: Yes
- Role required: `agent` (self only) or `admin`

Request body:

- None

Query params:

- None

Response example:

```json
{
  "evaluations": [
    {
      "_id": "67f0d500d1a2b35f8e8e0301",
      "conversation": "67f0d2b8d1a2b35f8e8e0007",
      "agent": "67f0d300d1a2b35f8e8e0100",
      "score": 8,
      "feedback": "Clear and empathetic",
      "issues": [],
      "suggestions": ["Ask one more clarifying question"],
      "createdAt": "2026-03-31T08:40:00.000Z"
    }
  ],
  "stats": {
    "averageScore": 8,
    "totalEvaluations": 1
  }
}
```

### GET /api/evaluations/conversation/:conversationId

- Description: Get evaluations for a conversation.
- Auth required: Yes
- Role required: patient owner or specialist with conversation access

Request body:

- None

Query params:

- None

Response example:

```json
[
  {
    "_id": "67f0d500d1a2b35f8e8e0301",
    "conversation": "67f0d2b8d1a2b35f8e8e0007",
    "agent": "67f0d300d1a2b35f8e8e0100",
    "score": 8,
    "feedback": "Clear and empathetic",
    "issues": [],
    "suggestions": ["Ask one more clarifying question"],
    "createdAt": "2026-03-31T08:40:00.000Z"
  }
]
```

---

## Analytics

### GET /api/dashboard/stats/overview

- Description: Get system-level dashboard stats.
- Auth required: Yes
- Role required: `agent`

Request body:

- None

Query params:

- None

Response example:

```json
{
  "totalConversations": 120,
  "activeConversations": 18,
  "resolvedConversations": 90,
  "resolutionRate": 75,
  "totalMessages": 1380,
  "priorityDistribution": {
    "high": 32,
    "medium": 55,
    "low": 33
  },
  "intentDistribution": {
    "symptom_report": 60,
    "appointment": 25,
    "general": 15
  },
  "channelDistribution": {
    "human": 80,
    "ai": 40
  }
}
```

### GET /api/dashboard/stats/agent/:agentId

- Description: Get per-specialist performance stats.
- Auth required: Yes
- Role required: `agent`

Request body:

- None

Query params:

- None

Response example:

```json
{
  "agentId": "67f0d300d1a2b35f8e8e0100",
  "totalConversations": 40,
  "resolvedConversations": 31,
  "resolutionRate": 78,
  "avgResponseTimeMs": 24500,
  "avgResponseTimeFormatted": "24.5s",
  "evaluation": {
    "averageScore": 8.4,
    "totalEvaluations": 24,
    "minScore": 6,
    "maxScore": 10
  }
}
```

---

## Queue (DLQ)

### GET /api/queue/dlq

- Description: List dead-letter queue jobs.
- Auth required: Yes
- Role required: `agent`

Query params:

- `page` (optional, default `1`)
- `limit` (optional, default `20`, max `100`)

Request body:

- None

Response example:

```json
{
  "total": 2,
  "jobs": [
    {
      "id": "dlq:msg-123:1711862400000",
      "name": "dead-letter-message",
      "timestamp": 1711862400000,
      "reason": "Processing timeout after 45000ms",
      "attemptsMade": 3,
      "failedAt": "2026-03-31T08:50:00.000Z",
      "payload": {
        "conversationId": "67f0d2b8d1a2b35f8e8e0007",
        "messageId": "67f0d3f2d1a2b35f8e8e0201",
        "patientId": "67f0d1f6d1a2b35f8e8e0001",
        "priority": "high",
        "intent": "symptom_report"
      }
    }
  ]
}
```

### GET /api/queue/dlq/:jobId

- Description: Get a single DLQ job detail.
- Auth required: Yes
- Role required: `agent`

Request body:

- None

Query params:

- None

Response example:

```json
{
  "id": "dlq:msg-123:1711862400000",
  "name": "dead-letter-message",
  "timestamp": 1711862400000,
  "state": "waiting",
  "reason": "Processing timeout after 45000ms",
  "attemptsMade": 3,
  "failedAt": "2026-03-31T08:50:00.000Z",
  "payload": {
    "conversationId": "67f0d2b8d1a2b35f8e8e0007",
    "messageId": "67f0d3f2d1a2b35f8e8e0201",
    "patientId": "67f0d1f6d1a2b35f8e8e0001",
    "priority": "high",
    "intent": "symptom_report"
  }
}
```

### POST /api/queue/dlq/:jobId/retry

- Description: Requeue a DLQ job back to message-processing queue.
- Auth required: Yes
- Role required: `agent`

Request body:

- None

Query params:

- None

Response example:

```json
{
  "retried": true,
  "messageId": "67f0d3f2d1a2b35f8e8e0201"
}
```

---

## Health

### GET /api/health

- Description: Liveness and basic dependency health.
- Auth required: No
- Role required: None

Request body:

- None

Query params:

- None

Response example:

```json
{
  "status": "ok",
  "info": {
    "mongodb": { "status": "up" },
    "redis": { "status": "up" }
  },
  "error": {},
  "details": {
    "mongodb": { "status": "up" },
    "redis": { "status": "up" }
  }
}
```

### GET /api/health/readiness

- Description: Readiness checks used for deployment/runtime gates.
- Auth required: No
- Role required: None

Request body:

- None

Query params:

- None

Response example:

```json
{
  "status": "ok",
  "info": {
    "mongodb": { "status": "up" },
    "redis": { "status": "up" },
    "queue": { "status": "up" },
    "websocket": { "status": "up" }
  },
  "error": {},
  "details": {
    "mongodb": { "status": "up" },
    "redis": { "status": "up" },
    "queue": { "status": "up" },
    "websocket": { "status": "up" }
  }
}
```

---

## Example End-to-End Flow

1. Patient logs in: `POST /api/auth/login`.
2. Patient creates conversation: `POST /api/conversations`.
3. Patient sends message: `POST /api/conversations/:conversationId/messages`.
4. Specialist loads queue: `GET /api/conversations`.
5. Specialist opens and replies: `GET /api/conversations/:id/messages` then `POST /api/conversations/:conversationId/messages`.
6. Specialist checks AI assist: `GET /api/conversations/:conversationId/messages/ai-assist`.
7. Specialist monitors stats: `GET /api/dashboard/stats/overview`.

---

## Notes

- Validation uses strict DTO validation with whitelist and forbidden unknown fields.
- Some access rules are context-based (patient ownership, specialist assignment, queue visibility).
- All protected routes require a valid access token.
