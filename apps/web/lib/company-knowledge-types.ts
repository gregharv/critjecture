export type CompanyKnowledgeMatch = {
  file: string;
  line: number;
  text: string;
};

export type CompanyKnowledgePreview =
  | {
      kind: "csv";
      columns: string[];
      rows: string[][];
    }
  | {
      kind: "text";
      lines: string[];
    };

export type CompanyKnowledgeCandidateFile = {
  file: string;
  matchedTerms: string[];
  matches: CompanyKnowledgeMatch[];
  preview: CompanyKnowledgePreview;
  score: number;
};

export type CompanyKnowledgeSelectionReason =
  | "single-candidate"
  | "unique-year-match"
  | "multiple-candidates"
  | "no-match";

export type CompanyKnowledgeSearchResult = {
  candidateFiles: CompanyKnowledgeCandidateFile[];
  matches: CompanyKnowledgeMatch[];
  recommendedFiles: string[];
  searchedDirectory: string;
  scopeDescription: string;
  selectedFiles: string[];
  selectionReason: CompanyKnowledgeSelectionReason;
  selectionRequired: boolean;
};
