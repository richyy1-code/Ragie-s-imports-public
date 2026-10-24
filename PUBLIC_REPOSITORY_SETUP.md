# Publish the portfolio repository

Keep the existing production repository private and connected to Render. Create a separate public repository for this copy.

1. Extract Ragies-Imports-Public.zip into a new folder, outside your existing production repository.
2. Open GitHub Desktop and select File > New Repository.
3. Use the name ragies-imports-public. Choose a local path so the repository contains the extracted project files directly, not another nested project folder. If easier, create an empty repository folder first, then copy the extracted folder contents into it.
4. Use this description: Full stack ecommerce platform with a React storefront, Express API, PostgreSQL, Clerk authentication, Paystack payments, shipment management, and staff administration.
5. Confirm README.md, Dockerfile, package.json, and artifacts are at the repository root. Do not copy files from your old repository or its Git history.
6. Review Changes in GitHub Desktop. Commit with the summary: Initial public portfolio release.
7. Click Publish repository and clear Keep this code private. Publish to your GitHub account.
8. On GitHub, set the repository website to https://ragieimports.com and pin the repository on your profile.

This is a separate source snapshot. It does not automatically receive future changes to the private production repository. Future public updates should be reviewed for private information before copying them across.
