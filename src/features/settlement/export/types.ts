/** Datos de un lote contable tal como se exportan (todo sale de la base de datos). */
export type BatchLine = {
  line_no: number;
  employee_code: string;
  employee_name: string;
  expense_date: string;
  category_code: string;
  category_name: string;
  account_code: string;
  tax_account_code: string | null;
  counterpart_account_code: string | null;
  cost_center: string | null;
  project_code: string | null;
  merchant_name: string | null;
  merchant_tax_id: string | null;
  document_number: string | null;
  currency: string;
  base_cents: number | null;
  tax_cents: number | null;
  total_cents: number;
  adjustment_reason: string | null;
  expense_id: string | null;
};

export type TotalRow = {
  dimension: "total" | "employee" | "category" | "account" | "cost_center" | "project";
  key: string;
  label: string;
  currency: string;
  base_cents: number;
  tax_cents: number;
  total_cents: number;
  lines: number;
};

export type BatchExportData = {
  companyName: string;
  companySlug: string;
  batch: {
    id: string;
    sequence: number;
    kind: "regular" | "corrective";
    periodMonth: string; // aaaa-mm-01
    closedAt: string; // ISO
    correctsSequence: number | null;
    note: string | null;
  };
  lines: BatchLine[];
  totals: TotalRow[];
};
