import { permanentRedirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getForumTypeForRequest } from "@/server/utils/requestUtil";
import { getDiscourseTopicRedirect } from "@/server/discourseRedirects";

// Links to topics and replies on the old Discourse forum (forum.secondrenaissance.net)
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  permanentRedirect(await getDiscourseTopicRedirect(path, getForumTypeForRequest(req)));
}
