# About this service

- External part of manager service handle these requests: `POST /api/v1/hash/crack` and `GET /api/v1/hash/crack/status`
- Internal part of manager service handle these requests: `PATCH /internal/api/v1/manager/hash/crack/request` (communicate with worker service to fetch result of worker job)
