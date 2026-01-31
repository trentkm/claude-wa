import fs from "fs";
import path from "path";

// Supported image extensions
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

/**
 * Extract image paths from Claude's response text
 * Looks for [IMAGE: /path/to/file.png] or [FILE: /path/to/file.png] tags
 *
 * @param {string} text - Claude's response text
 * @returns {{ cleanText: string, imagePaths: string[] }}
 */
export function extractImages(text) {
  const imagePaths = [];

  // Match [IMAGE: path] or [FILE: path] tags
  const tagRegex = /\[(IMAGE|FILE):\s*([^\]]+)\]/gi;

  let cleanText = text;
  let match;

  while ((match = tagRegex.exec(text)) !== null) {
    const filePath = match[2].trim();
    const ext = path.extname(filePath).toLowerCase();

    // Only include if it's a supported image type
    if (IMAGE_EXTENSIONS.includes(ext)) {
      // Validate file exists
      if (fs.existsSync(filePath)) {
        imagePaths.push(filePath);
      } else {
        console.warn(`Image file not found: ${filePath}`);
      }
    }
  }

  // Remove the tags from the text
  cleanText = cleanText.replace(tagRegex, "").trim();

  // Clean up multiple newlines that might result from tag removal
  cleanText = cleanText.replace(/\n{3,}/g, "\n\n");

  return { cleanText, imagePaths };
}

/**
 * Read an image file and return its buffer
 * @param {string} filePath - Path to the image file
 * @returns {Buffer}
 */
export function readImage(filePath) {
  return fs.readFileSync(filePath);
}
