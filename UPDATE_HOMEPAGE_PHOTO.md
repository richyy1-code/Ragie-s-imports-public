# Fixed homepage photo update

The homepage now uses one fixed boutique photo, independently of products. The image fits its natural portrait proportions without stretching, cropping, rotation, or a product name overlay. The attached low resolution photograph was enhanced with AI to 1024 by 1535 pixels, so some fine details may differ from the original.

Product uploads still send the original file bytes without compression. A notice now appears when a selected photo is smaller than 1200 pixels on either side. Uploads are still allowed. Existing small photos must be replaced with higher resolution originals to become clearer.

## Publish

1. Extract this ZIP.
2. In GitHub Desktop, open your existing repository folder.
3. Copy the extracted project contents into that folder and replace matching files. Do not add a nested project folder.
4. Commit with the message: Set fixed homepage photo and add image quality guidance.
5. Push origin and wait for Render to deploy the commit.
6. Open ragieimports.com and refresh. Confirm the homepage image stays the same when products change. Upload a small test photo to confirm the quality notice appears.

This photo update requires no database change. If you have not yet applied the earlier shipment closing date update, follow UPDATE_BATCH_CLOSING.md before deploying this ZIP, which includes that earlier update.
