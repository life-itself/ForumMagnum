import { permanentRedirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getForumTypeForRequest } from "@/server/utils/requestUtil";
import { getDiscourseUploadRedirect } from "@/server/discourseRedirects";

// Links to files uploaded to the old Discourse forum (forum.secondrenaissance.net)
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  permanentRedirect(await getDiscourseUploadRedirect(path, getForumTypeForRequest(req)));
}
