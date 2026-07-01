# Release Checklist

Use this before tagging a public release.

1. Run `npm ci`.
2. Run `npm run build`.
3. Run `npm test`.
4. Run `npm run desktop` and confirm the popup opens.
5. Run the privacy scan:

   ```bash
   rg -n -i "private-character-name|C:\\\\Characters|C:\\\\Users|token|secret|api[_-]?key|auth.json" -g "!node_modules" -g "!package-lock.json"
   ```

6. Confirm no generated photos, uploads, output caches, auth files, or private source images are staged.
7. Commit, tag, and push.

Watermark owner: `dev-willbird1936`.
