function toAnalysisErrorMessage(message: string) {
  return message
    .replace("Requested causal study was not found.", "Requested analysis study was not found.")
    .replace(
      "Archived causal studies cannot be resumed for new intake.",
      "Archived analysis studies cannot be resumed for new intake.",
    )
    .replace("Causal study not found for DAG.", "Analysis study not found for DAG.")
    .replace("Causal DAG version not found.", "Analysis DAG version not found.")
    .replace("Causal DAG not found.", "Analysis DAG not found.")
    .replace("Causal study not found.", "Analysis study not found.")
    .replace(
      "Comparison runs must belong to the current causal study.",
      "Comparison runs must belong to the current analysis study.",
    )
    .replace(
      "A causal study question is required before run creation.",
      "An analysis study question is required before run creation.",
    )
    .replace(
      "An approval for the exact DAG version is required before creating a causal run.",
      "An approval for the exact DAG version is required before creating an analysis run.",
    )
    .replace("Causal artifact not found.", "Analysis artifact not found.")
    .replace("Causal run not found.", "Analysis run not found.")
    .replace("Causal run execution failed.", "Analysis run execution failed.");
}

export function normalizeAnalysisError(error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? toAnalysisErrorMessage(error.message) : fallbackMessage;
  const normalized = new Error(message);

  if (error instanceof Error && error.stack) {
    normalized.stack = error.stack;
  }

  return normalized;
}
