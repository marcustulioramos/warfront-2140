# Security

Do not report exploitable vulnerabilities in public issues. Contact the maintainers privately through the repository security advisory feature. Never commit credentials. Treat all client messages as untrusted.

The Milestone 1 development server has no authentication, uses one hardcoded player identity and exposes its state endpoint. It must not be exposed to the public Internet. Authentication, rate limiting and per-player visibility are required before public hosting.
