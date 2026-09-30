import { authService } from "./auth.service";
import { apiUrl } from "./api";

export const fileService = {
  async openFile(fileId: number) {
    if (!Number.isInteger(fileId) || fileId <= 0) {
      throw new Error("Invalid file ID.");
    }

    // =====================================================
    // OPEN WINDOW IMMEDIATELY
    //
    // This must happen before await/fetch so the browser
    // recognizes it as part of the user's click.
    // =====================================================

    const fileWindow = window.open("", "_blank");

    if (!fileWindow) {
      throw new Error(
        "The browser blocked the file window. Please allow pop-ups and try again.",
      );
    }

    try {
      // ===================================================
      // SHOW TEMPORARY LOADING MESSAGE
      // ===================================================

      fileWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Loading file...</title>
            <meta charset="UTF-8" />
          </head>

          <body
            style="
              font-family: Arial, sans-serif;
              padding: 40px;
              text-align: center;
            "
          >
            <p>Loading file...</p>
          </body>
        </html>
      `);

      fileWindow.document.close();

      // ===================================================
      // REQUEST PROTECTED FILE
      // ===================================================

      const response = await authService.authFetch(
        apiUrl(`/api/files/${fileId}`),
        {
          method: "GET",
        },
      );

      // ===================================================
      // UNAUTHORIZED
      // ===================================================

      if (response.status === 401) {
        fileWindow.close();

        throw new Error("Your session has expired. Please log in again.");
      }

      // ===================================================
      // FORBIDDEN
      // ===================================================

      if (response.status === 403) {
        fileWindow.close();

        throw new Error("You are not authorized to access this file.");
      }

      // ===================================================
      // OTHER ERRORS
      // ===================================================

      if (!response.ok) {
        let message = "Unable to open file.";

        try {
          const data = await response.json();

          message = data?.message || data?.error || message;
        } catch {
          // Response may not contain JSON.
        }

        fileWindow.close();

        throw new Error(message);
      }

      // ===================================================
      // CREATE TEMPORARY BLOB URL
      // ===================================================

      const blob = await response.blob();

      const objectUrl = URL.createObjectURL(blob);

      // ===================================================
      // LOAD FILE INTO ALREADY-OPEN WINDOW
      // ===================================================

      fileWindow.location.href = objectUrl;

      // ===================================================
      // CLEANUP
      //
      // Give the browser enough time to load the Blob.
      // ===================================================

      window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 60_000);
    } catch (error) {
      if (fileWindow && !fileWindow.closed) {
        fileWindow.close();
      }

      throw error;
    }
  },
};
