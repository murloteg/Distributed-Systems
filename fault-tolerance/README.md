# How to deploy application?

1. Go to the `/fault-tolerance/deploy` directory.
2. Run `docker compose -d --build` command.
3. Wait until the containers are created.
4. Go to the Bruno/Postman and try to send request by `POST http://localhost:3000/api/v1/hash/crack` endpoint.
   Example payload for this request:

```json
{
	"hash": "e2fc714c4727ee9395f324cd2e7f331f",
	"maxLength": 4
}
```

5. Check logs of containers (`docker logs manager-container -f` or `docker logs deploy-worker-app-* -f`)

---

## Scheme of distributed system

![DrawIO Scheme](./assets/fault-tolerance.svg)
