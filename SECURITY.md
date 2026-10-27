# Security

Reqora is currently a local, single-user beta. Workspace credentials, cookies, certificates, and variables are stored without encryption and can appear in exports. Do not deploy the request engine as a public shared service or attach unredacted exports to issues.

For a security issue that exposes private data or enables unintended code execution, arrange a private reporting channel with the maintainer through [the maintainer's GitHub profile](https://github.com/ajthr), or use GitHub's private vulnerability reporting option if available. Do not post credentials or working exploit details in a public issue. Include the affected version, platform, impact, and sanitized reproduction steps.

Security fixes will be delivered in new releases; published release binaries and tags are not silently replaced.
