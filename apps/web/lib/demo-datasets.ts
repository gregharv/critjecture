export type DemoDatasetDownloadMode = "single-file" | "zip-bundle";

export type DemoDataset = {
  description: string;
  downloadMode: DemoDatasetDownloadMode;
  filename: string;
  id: string;
  sourceUrl: string;
  title: string;
  uploadHint: string;
};

export const DEMO_DATASETS: DemoDataset[] = [
  {
    description:
      "A classic business analytics dataset with orders, customers, products, profit, and geography.",
    downloadMode: "single-file",
    filename: "superstore-sales.csv",
    id: "superstore-sales",
    sourceUrl:
      "https://raw.githubusercontent.com/curran/data/gh-pages/superstoreSales/superstoreSales.csv",
    title: "Superstore sales",
    uploadHint: "Good for quick charting and profit/revenue questions.",
  },
  {
    description:
      "A popular HR analytics dataset with employee demographics, job roles, compensation, and attrition.",
    downloadMode: "single-file",
    filename: "employee-attrition.csv",
    id: "employee-attrition",
    sourceUrl:
      "https://raw.githubusercontent.com/pplonski/datasets-for-start/master/employee_attrition/HR-Employee-Attrition-All.csv",
    title: "Employee attrition",
    uploadHint: "Useful for segmentation, churn, and department-level analysis.",
  },
  {
    description:
      "A sales order dataset with customer names, line items, dates, quantities, prices, and tax amounts.",
    downloadMode: "single-file",
    filename: "sales-orders.csv",
    id: "sales-orders",
    sourceUrl: "https://raw.githubusercontent.com/MicrosoftLearning/dp-data/main/sales.csv",
    title: "Sales orders",
    uploadHint: "Handy for time-series, product mix, and revenue analysis.",
  },
  {
    description:
      "A GitHub-hosted ZIP archive with multiple small datasets you can extract and upload as a directory.",
    downloadMode: "zip-bundle",
    filename: "datasets-for-start.zip",
    id: "datasets-for-start-bundle",
    sourceUrl: "https://github.com/pplonski/datasets-for-start/archive/refs/heads/master.zip",
    title: "Dataset pack ZIP",
    uploadHint: "Best if you want to demo directory upload with multiple files at once.",
  },
];

export function getDemoDataset(datasetId: string) {
  return DEMO_DATASETS.find((dataset) => dataset.id === datasetId) ?? null;
}
