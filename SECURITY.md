# Security

Report security issues privately through GitHub security advisories or by opening a minimal issue that does not include secrets.

Do not commit:

- API keys
- Codex auth files
- generated `output/` folders
- uploaded source photos
- private character references

The provider adapters redact common secret patterns from logs. Keep real credentials in environment variables or local secret managers only.
