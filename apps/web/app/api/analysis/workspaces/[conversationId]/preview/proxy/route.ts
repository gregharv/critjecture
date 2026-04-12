import { proxyAnalysisPreviewRequest } from "@/lib/marimo-preview-proxy";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  return proxyAnalysisPreviewRequest({
    context: {
      params: context.params.then((params) => ({ ...params, previewPath: [] })),
    },
    request,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
) {
  return proxyAnalysisPreviewRequest({
    context: {
      params: context.params.then((params) => ({ ...params, previewPath: [] })),
    },
    request,
  });
}
