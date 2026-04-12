import { proxyAnalysisPreviewRequest } from "@/lib/marimo-preview-proxy";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string; previewPath: string[] }> },
) {
  return proxyAnalysisPreviewRequest({
    context,
    request,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string; previewPath: string[] }> },
) {
  return proxyAnalysisPreviewRequest({
    context,
    request,
  });
}
