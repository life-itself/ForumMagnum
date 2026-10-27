import fs from "node:fs";
import path from "node:path";
import pgPromise from "pg-promise";
import { v2 as cloudinary } from "cloudinary";
import { cloudinaryCloudName } from "@/lib/instanceSettings";
import { Images } from "@/server/collections/images/collection";
import { findAlreadyMovedImage, getOrCreateCloudinaryImage, type CloudinaryCredentials } from "@/server/scripts/convertImagesToCloudinary";
import { getSourceUrl } from "./secondRenaissanceDiscourseSource";
import { DISCOURSE_ORIGIN } from "./secondRenaissanceDiscourseHtml";

/* eslint-disable no-console */

/**
 * Moves files uploaded to the Discourse forum (images, PDFs, other
 * attachments) to Cloudinary (issue #42), so migrated posts stop depending on
 * the Discourse server. Files are read from the backup's `uploads/` folder,
 * not fetched from the server. Each file is uploaded once: the Images table
 * records its Cloudinary URL under its original Discourse URL, so later runs
 * reuse it.
 */

export interface DiscourseUpload {
  /** e.g. /uploads/db6903/original/1X/<sha1>.png */
  url: string
  sha1: string
  extension: string | null
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "heic"]);
const CLOUDINARY_FOLDER = "discourseUploads";

// Discourse's short upload URLs encode the file's SHA-1 in base62
const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function base62Sha1(sha1: string): string {
  const base = BigInt(62);
  let n = BigInt(`0x${sha1}`);
  let encoded = "";
  while (n > BigInt(0)) {
    encoded = BASE62[Number(n % base)] + encoded;
    n /= base;
  }
  return encoded;
}

/** The /uploads/... path of a Discourse upload link, without its query or fragment; null for other links */
export function discourseUploadPath(url: string): string | null {
  const urlPath = url.startsWith(DISCOURSE_ORIGIN) ? url.slice(DISCOURSE_ORIGIN.length) : url;
  if (!urlPath.startsWith("/uploads/")) return null;
  return urlPath.split(/[?#]/)[0];
}

// Absolute Discourse links, or relative ones at the start of an attribute value or srcset entry
const UPLOAD_LINK = /(?:https:\/\/forum\.secondrenaissance\.net|(?<=["'\s,]))\/uploads\/[^"'\s?#,)]+/g;

/** The /uploads/... paths a piece of Discourse HTML links to */
export function findDiscourseUploadPaths(cooked: string): string[] {
  return (cooked.match(UPLOAD_LINK) ?? []).map(link => discourseUploadPath(link)!);
}

/**
 * Every path Discourse links an upload by: its original URL, resized
 * versions, its short URL and its download link.
 */
export async function loadDiscourseUploads(): Promise<Map<string, DiscourseUpload>> {
  const source = pgPromise()(getSourceUrl());
  try {
    const uploads: DiscourseUpload[] = await source.any(`SELECT url, sha1, extension FROM uploads WHERE sha1 ~ '^[0-9a-f]{40}$'`);
    const optimized: { url: string, sha1: string }[] = await source.any(`
      SELECT o.url, u.sha1 FROM optimized_images o JOIN uploads u ON u.id = o.upload_id
    `);
    const bySha1 = new Map(uploads.map(u => [u.sha1, u]));
    const byPath = new Map<string, DiscourseUpload>();
    for (const upload of uploads) {
      const shortUrl = `/uploads/short-url/${base62Sha1(upload.sha1)}`;
      const downloadUrl = upload.url.replace(/\/original\/\dX\/.*$/, `/${upload.sha1}`);
      for (const key of [upload.url, shortUrl, `${shortUrl}.${upload.extension}`, downloadUrl]) byPath.set(key, upload);
    }
    for (const resized of optimized) {
      const upload = bySha1.get(resized.sha1);
      if (upload) byPath.set(resized.url, upload);
    }
    return byPath;
  } finally {
    // Only close this connection; pgp.end() would also close the app's database pool
    await source.$pool.end();
  }
}

function getCloudinaryCredentials(): CloudinaryCredentials {
  const apiKey = process.env.private_cloudinaryApiKey;
  const apiSecret = process.env.private_cloudinaryApiSecret;
  if (!apiKey || !apiSecret || !process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME) {
    throw new Error("Cloudinary credentials (NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, private_cloudinaryApiKey, private_cloudinaryApiSecret) are required");
  }
  return { cloud_name: cloudinaryCloudName, api_key: apiKey, api_secret: apiSecret };
}

/**
 * Files are named by their hash, so uploading the same file again (from a
 * test database, or a fresh one) reuses the existing copy instead of making a
 * duplicate. Raw files keep their extension so the link opens correctly.
 */
function cloudinaryName(upload: DiscourseUpload) {
  const isImage = IMAGE_EXTENSIONS.has(upload.extension?.toLowerCase() ?? "");
  return {
    folder: CLOUDINARY_FOLDER,
    public_id: isImage || !upload.extension ? upload.sha1 : `${upload.sha1}.${upload.extension}`,
    overwrite: false,
  };
}

async function uploadFile(upload: DiscourseUpload, filePath: string, credentials: CloudinaryCredentials): Promise<string | null> {
  const identifier = `${DISCOURSE_ORIGIN}${upload.url}`;
  if (IMAGE_EXTENSIONS.has(upload.extension?.toLowerCase() ?? "")) {
    return getOrCreateCloudinaryImage({
      identifier,
      identifierType: "originalUrl",
      upload: () => cloudinary.uploader.upload(filePath, { ...credentials, ...cloudinaryName(upload) }),
    });
  }
  // PDFs and other attachments are stored as-is, so Cloudinary doesn't turn them into images
  const result = await cloudinary.uploader.upload(filePath, {
    ...credentials,
    ...cloudinaryName(upload),
    resource_type: "raw",
  });
  await Images.rawInsert({ identifier, identifierType: "originalUrl", cdnHostedUrl: result.secure_url, originalUrl: null });
  return result.secure_url;
}

export interface MirroredUploads {
  /** Cloudinary URL for each Discourse link path */
  urlsByPath: Map<string, string>
  uploaded: number
  /** Not on Cloudinary yet; uploaded only on a real run with an uploads folder */
  pending: number
  failed: string[]
}

/**
 * Cloudinary URLs for the given upload links. Files already on Cloudinary are
 * reused; others are uploaded from `uploadsDir` (the backup's `uploads/`
 * folder) when `execute` is set.
 */
export async function mirrorDiscourseUploads(linkPaths: Iterable<string>, uploadsByPath: Map<string, DiscourseUpload>, { uploadsDir, execute }: {
  uploadsDir?: string,
  execute: boolean,
}): Promise<MirroredUploads> {
  const pathsByUpload = new Map<DiscourseUpload, string[]>();
  for (const linkPath of linkPaths) {
    const upload = uploadsByPath.get(linkPath);
    if (!upload) continue;
    pathsByUpload.set(upload, [...(pathsByUpload.get(upload) ?? []), linkPath]);
  }
  const result: MirroredUploads = { urlsByPath: new Map(), uploaded: 0, pending: 0, failed: [] };
  const credentials = execute && uploadsDir ? getCloudinaryCredentials() : null;
  for (const [upload, paths] of pathsByUpload) {
    let cdnUrl = await findAlreadyMovedImage(`${DISCOURSE_ORIGIN}${upload.url}`);
    if (!cdnUrl && credentials && uploadsDir) {
      const filePath = path.join(uploadsDir, upload.url.replace(/^\/uploads\//, ""));
      if (!fs.existsSync(filePath)) {
        result.failed.push(`${upload.url} (not in the uploads folder)`);
        continue;
      }
      try {
        cdnUrl = await uploadFile(upload, filePath, credentials);
        result.uploaded++;
      } catch (e) {
        result.failed.push(`${upload.url} (${e instanceof Error ? e.message : String(e)})`);
        continue;
      }
    }
    if (!cdnUrl) {
      result.pending++;
      continue;
    }
    for (const linkPath of paths) result.urlsByPath.set(linkPath, cdnUrl);
  }
  return result;
}
