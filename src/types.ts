export interface OkResponse {
  ok: boolean;
}

/* ---------- /api/health ---------- */
export interface HealthStats {
  students: number;
  classes: number;
  imports: number;
  attendanceDays: number;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  dataDir: string;
  now: string;
  stats: HealthStats;
}

/* ---------- /api/meta ---------- */
export interface School {
  id: string;
  name: string;
  directorate: string;
  administration: string;
  active: boolean;
}

export interface ClassInfo {
  id: string;
  schoolId: string;
  stage: string;
  grade: string;
  section: string;
  name: string;
  studentCount: number;
  sourceFile?: string;
  importedAt?: string;
}

export interface MetaResponse {
  ok: boolean;
  directorate: string;
  administration: string;
  schools: School[];
  classes: ClassInfo[];
  siteUrl: string;
  excelTemplateVerified: boolean;
}

/* ---------- /api/students ---------- */
export type VerificationStatus = 'verified' | 'needs_review';

export interface StudentSource {
  file?: string;
  page?: number;
  importedAt?: string;
}

export interface Student {
  id: string;
  studentCode: string;
  fullName: string;
  classId: string;
  classLabel?: string;
  schoolId?: string;
  stage?: string;
  grade?: string;
  section?: string;
  active?: boolean;
  verificationStatus: VerificationStatus;
  reviewNotes?: string[];
  createdAt?: string;
  updatedAt?: string;
  source?: StudentSource;
}

export interface StudentsResponse {
  ok: boolean;
  total: number;
  results: Student[];
}

export interface StudentSaveResponse {
  ok: boolean;
  student: Student;
  created: boolean;
}

/* ---------- /api/pdf ---------- */
export interface PdfHeader {
  directorate?: string;
  administration?: string;
  school?: string;
  stage?: string;
  grade?: string;
  section?: string;
  className?: string;
  totalStudents?: number;
  date?: string;
  academicYear?: string;
}

export interface PdfCell {
  kind: string;
  text: string;
  x0?: number;
  x1?: number;
}

export interface PdfRow {
  index: number;
  studentCode: string;
  fullName: string;
  cells: PdfCell[];
  needsReview: boolean;
  reviewNotes: string[];
}

export interface UnmappedGlyph {
  font: string;
  gid: number;
  count: number;
}

export interface DuplicateInFile {
  studentCode: string;
  rows: number[];
}

export interface PdfExtractResponse {
  ok: boolean;
  fileName: string;
  pages: number;
  header: PdfHeader;
  rows: PdfRow[];
  warnings: string[];
  unmapped: UnmappedGlyph[];
  duplicatesInFile: DuplicateInFile[];
}

export type ImportMode = 'merge' | 'create_class';

export interface PdfConfirmBody {
  fileName: string;
  header: PdfHeader;
  rows: PdfRow[];
  classId: string;
  mode: ImportMode;
}

export interface Conflict {
  studentCode: string;
  field: string;
  existing: string;
  incoming: string;
  studentId?: string;
}

export interface PdfConfirmResponse {
  ok: boolean;
  importId: string;
  added: number;
  updated: number;
  skipped: number;
  needsReview: number;
  conflicts: Conflict[];
  classId: string;
}

export interface ImportHistoryItem {
  id: string;
  fileName: string;
  importedAt: string;
  classId: string;
  classLabel: string;
  added: number;
  updated: number;
  skipped: number;
  needsReview: number;
  conflicts: number;
  pages: number;
}

export interface ImportsResponse {
  ok: boolean;
  history: ImportHistoryItem[];
}

/* ---------- /api/attendance ---------- */
export interface AttendanceSelectedStudent {
  id: string;
  studentCode: string;
  fullName: string;
}

export interface AttendanceDayClass {
  classId: string;
  classLabel: string;
  stage?: string;
  grade?: string;
  section?: string;
  selectedCount: number;
  selected: AttendanceSelectedStudent[];
}

export interface LatestExport {
  exportedAt?: string;
  path?: string;
  fileName?: string;
  rowCount?: number;
}

export interface AttendanceDayResponse {
  ok: boolean;
  date: string;
  classes: AttendanceDayClass[];
  export?: LatestExport | null;
  automation?: unknown;
}

export interface AttendanceReportStudent {
  id: string;
  studentCode: string;
  fullName: string;
  selected: boolean;
}

export interface AttendanceReportResponse {
  ok: boolean;
  date: string;
  classId: string;
  students: AttendanceReportStudent[];
}

export interface AttendanceSelectResponse {
  ok: boolean;
  date: string;
  classId: string;
  count: number;
}

export interface ExportResponse {
  ok: boolean;
  path: string;
  fileName: string;
  rowCount: number;
  columns: string[];
}

export interface LatestExportFile {
  ok: boolean;
  file?: {
    path: string;
    fileName: string;
    size: number;
    createdAt: string;
  };
}

/* ---------- /api/settings ---------- */
export type BrowserName = 'msedge' | 'chrome' | 'chromium';

export interface Settings {
  siteUrl: string;
  siteName: string;
  browser: BrowserName;
  headless: boolean;
  timeoutMs: number;
  manualFallback: boolean;
  openDevTools?: boolean;
  exportDir: string;
  autoExportBeforeRun: boolean;
}

export interface SettingsResponse {
  ok: boolean;
  settings: Settings;
}

/* ---------- /api/automation ---------- */
export type AutomationStatus =
  | 'success'
  | 'needs_manual'
  | 'blocked_captcha'
  | 'missing_url'
  | 'error'
  | 'partial'
  | 'idle';

export interface AutomationStep {
  step: string;
  ok: boolean;
  detail?: string;
  at?: string;
}

export interface AutomationEvidence {
  type: string;
  path: string;
  at?: string;
}

export interface AutomationResult {
  ok: boolean;
  status: AutomationStatus;
  message?: string;
  steps: AutomationStep[];
  evidence: AutomationEvidence[];
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  excelPath?: string;
}

/* ---------- /api/logs ---------- */
export interface LogEntry {
  at: string;
  level: string;
  message: string;
}

export interface LogsResponse {
  ok: boolean;
  logs: LogEntry[];
}

/* ---------- navigation ---------- */
export type PageId =
  | 'dashboard'
  | 'import'
  | 'students'
  | 'attendance'
  | 'export'
  | 'automation'
  | 'settings';
