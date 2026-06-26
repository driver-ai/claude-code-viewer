export const extractCursorProjectSlug = (jsonlPath: string): string => {
  const segments = jsonlPath.split("/");
  const atIndex = segments.indexOf("agent-transcripts");
  if (atIndex > 0) {
    return segments[atIndex - 1] ?? "unknown-project";
  }
  return "unknown-project";
};
