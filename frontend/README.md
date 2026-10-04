# File Transfer frontend

React and TypeScript frontend for the file-transfer project.

Lets you pick a file, enter the upload passcode, upload the file directly to S3, and get a share link. Share links open a download page.

See the [project README](../README.md) for backend setup, environment variables, and current limitations. Start the backend on port 8000 before using the frontend; Vite forwards `/api` requests to it.

From this folder:

- `npm ci` installs dependencies from the lockfile.
- `npm run dev` starts the development server.
- `npm run build` checks TypeScript and builds the frontend.
- `npm run lint` checks the code for common problems.
