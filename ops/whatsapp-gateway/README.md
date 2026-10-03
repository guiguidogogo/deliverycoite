# WhatsApp reply context

The deployed gateway already has a custom `dist/src/inbox-content.js` module.
This copy preserves that implementation and adds `quotedMessage` to normalized
incoming events and content retrieval. It does not change sending, queues or AI.

Run `node ops/whatsapp-gateway/inbox-content.test.mjs` before deployment.
Use `deploy.py HOST CONTAINER` with `SSH_PASSWORD` and optionally `SSH_USER` in
the environment. It backs up the container image and module, updates only the
normalizer, restarts the gateway, checks `/health`, and preserves the updated
image under its existing tag. Failures restore the original module.

The current gateway contains manual additions not present in its upstream Git
branch. If its source image is rebuilt, reapply this module (or integrate it into
that gateway's source) before declaring reply context operational.

Delivery API and Web changes are built and deployed normally from Git.
The additive inbox columns mark existing messages as already read. New inbound
messages remain unread until the UI acknowledges their specific visible IDs.
