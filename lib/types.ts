export type CategoryKind = "spend" | "income" | "transfer";

export type Category = {
  id: string;
  name: string;
  color: string;
  kind: CategoryKind;
  default_budget_paise: number;
  sort: number;
  /** Set on categories you made yourself; system categories have none. */
  user_id?: string | null;
  /** Your own categories say whether they're a need, a want or avoidable. */
  grp?: "needs" | "wants" | "avoidable" | null;
};

export type TxSource = "manual" | "sms" | "shortcut" | "import" | "sample";

export type Transaction = {
  id: string;
  date: string; // YYYY-MM-DD
  amount_paise: number; // negative = money out
  merchant_name: string;
  merchant_raw: string | null;
  category_id: string;
  subcategory_id: string | null;
  source: TxSource;
  reviewed: boolean;
  note: string | null;
  account_id: string | null;
  import_id: string | null;
};

export type AccountType = "bank" | "card" | "investment" | "cash" | "loan";

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  balance_paise: number;
  last4: string | null;
  is_sample: boolean;
  updated_at: string;
};

export type Goal = {
  id: string;
  name: string;
  target_paise: number;
  saved_paise: number;
  target_date: string | null;
  color: string;
  is_sample: boolean;
  /** Fills itself: "invest" counts SIPs and other investments, "payee" counts payments matching link_value. */
  link_kind?: "invest" | "payee" | null;
  link_value?: string | null;
  link_from?: string | null;
  created_at?: string;
};

export type BudgetRow = { category_id: string; month: string; limit_paise: number };

export type MerchantRule = { pattern: string; category_id: string; subcategory_id?: string | null; rename_to: string | null };

export type Snapshot = { month: string; assets_paise: number; liabilities_paise: number };

/** Expected income from `month` onwards, until a later row replaces it. */
export type IncomePlanRow = { month: string; salary_paise: number; other_paise: number; payday: number | null; savings_goal_pct: number };
