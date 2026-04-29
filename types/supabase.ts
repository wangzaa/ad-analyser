export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_products: {
        Row: {
          account_id: number
          acquired_at: string
          id: number
          product_type_id: number
          removed_at: string | null
        }
        Insert: {
          account_id: number
          acquired_at: string
          id?: number
          product_type_id: number
          removed_at?: string | null
        }
        Update: {
          account_id?: number
          acquired_at?: string
          id?: number
          product_type_id?: number
          removed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_products_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "account_products_product_type_id_fkey"
            columns: ["product_type_id"]
            isOneToOne: false
            referencedRelation: "product_types"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: { created_at: string; external_account_id: string; id: number }
        Insert: { created_at?: string; external_account_id: string; id?: number }
        Update: { created_at?: string; external_account_id?: string; id?: number }
        Relationships: []
      }
      ad_sets: {
        Row: { campaign_id: number; id: number; name: string }
        Insert: { campaign_id: number; id?: number; name: string }
        Update: { campaign_id?: number; id?: number; name?: string }
        Relationships: [
          {
            foreignKeyName: "ad_sets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      ads: {
        Row: { ad_set_id: number; id: number; name: string }
        Insert: { ad_set_id: number; id?: number; name: string }
        Update: { ad_set_id?: number; id?: number; name?: string }
        Relationships: [
          {
            foreignKeyName: "ads_ad_set_id_fkey"
            columns: ["ad_set_id"]
            isOneToOne: false
            referencedRelation: "ad_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          end_date: string | null
          id: number
          name: string
          platform_id: number
          start_date: string | null
        }
        Insert: {
          end_date?: string | null
          id?: number
          name: string
          platform_id: number
          start_date?: string | null
        }
        Update: {
          end_date?: string | null
          id?: number
          name?: string
          platform_id?: number
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_events: {
        Row: {
          created_at: string
          customer_id: number
          event_type: string
          id: number
          occurred_at: string
          payload: Json
        }
        Insert: {
          created_at?: string
          customer_id: number
          event_type: string
          id?: number
          occurred_at: string
          payload?: Json
        }
        Update: {
          created_at?: string
          customer_id?: number
          event_type?: string
          id?: number
          occurred_at?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "customer_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          account_id: number
          acquisition_channel: string
          acquisition_date: string
          activation_date: string | null
          activation_lag_days: number | null
          activation_status: string
          ad_id: number
          age_band: string
          churn_date: string | null
          contract_months: number
          created_at: string
          cross_sell_broadband: boolean
          cross_sell_device_fin: boolean
          cross_sell_entertainment: boolean
          external_customer_id: string
          gender: string
          hk_district_id: number
          id: number
          language_pref: string
          monthly_arpu_hkd: number
          monthly_total_revenue_hkd: number
          months_active: number
          plan_type_id: number
          prior_tenure_months: number
          projected_ltv_24mo_hkd: number | null
          realized_revenue_hkd: number
          relationship_type: string
          status: string
          updated_at: string
        }
        Insert: Omit<Database["public"]["Tables"]["customers"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: number
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["customers"]["Row"]>
        Relationships: [
          {
            foreignKeyName: "customers_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_hk_district_id_fkey"
            columns: ["hk_district_id"]
            isOneToOne: false
            referencedRelation: "hk_districts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_plan_type_id_fkey"
            columns: ["plan_type_id"]
            isOneToOne: false
            referencedRelation: "plan_types"
            referencedColumns: ["id"]
          },
        ]
      }
      hk_districts: {
        Row: { id: number; name: string; region: string | null }
        Insert: { id?: number; name: string; region?: string | null }
        Update: { id?: number; name?: string; region?: string | null }
        Relationships: []
      }
      plan_types: {
        Row: {
          code: string
          contract_months_default: number | null
          default_arpu_hkd: number | null
          display_name: string
          id: number
          plan_category: string
        }
        Insert: {
          code: string
          contract_months_default?: number | null
          default_arpu_hkd?: number | null
          display_name: string
          id?: number
          plan_category: string
        }
        Update: {
          code?: string
          contract_months_default?: number | null
          default_arpu_hkd?: number | null
          display_name?: string
          id?: number
          plan_category?: string
        }
        Relationships: []
      }
      platforms: {
        Row: { code: string; display_name: string; id: number }
        Insert: { code: string; display_name: string; id?: number }
        Update: { code?: string; display_name?: string; id?: number }
        Relationships: []
      }
      product_types: {
        Row: {
          category: string | null
          code: string
          display_name: string
          id: number
          is_subscription: boolean
        }
        Insert: {
          category?: string | null
          code: string
          display_name: string
          id?: number
          is_subscription?: boolean
        }
        Update: {
          category?: string | null
          code?: string
          display_name?: string
          id?: number
          is_subscription?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      v_account_products_current: {
        Row: { account_id: number | null; products: string[] | null }
        Relationships: []
      }
      v_account_summary: {
        Row: {
          account_id: number | null
          external_account_id: string | null
          multi_product_flag: boolean | null
          n_active_lines: number | null
          total_account_arpu_hkd: number | null
        }
        Relationships: []
      }
      v_acquisition_by_campaign: {
        Row: {
          avg_arpu: number | null
          campaign_name: string | null
          customers_acquired: number | null
          customers_churned: number | null
          platform: string | null
          projected_ltv: number | null
          realized_revenue: number | null
        }
        Relationships: []
      }
      v_cohort_retention: {
        Row: {
          avg_months_active: number | null
          churned: number | null
          cohort_month: string | null
          cohort_size: number | null
          still_active: number | null
        }
        Relationships: []
      }
      v_customer_360: {
        Row: {
          acquisition_channel: string | null
          acquisition_date: string | null
          activation_date: string | null
          activation_lag_days: number | null
          activation_status: string | null
          ad_name: string | null
          ad_set_name: string | null
          age_band: string | null
          campaign_name: string | null
          churn_date: string | null
          contract_months: number | null
          cross_sell_broadband: boolean | null
          cross_sell_device_fin: boolean | null
          cross_sell_entertainment: boolean | null
          external_account_id: string | null
          external_customer_id: string | null
          gender: string | null
          hk_district: string | null
          id: number | null
          language_pref: string | null
          monthly_arpu_hkd: number | null
          months_active: number | null
          plan_category: string | null
          plan_type: string | null
          platform: string | null
          prior_tenure_months: number | null
          projected_ltv_24mo_hkd: number | null
          realized_revenue_hkd: number | null
          region: string | null
          relationship_type: string | null
          status: string | null
        }
        Relationships: []
      }
    }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
