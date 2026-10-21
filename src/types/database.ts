// ARCHIVO GENERADO. No editar a mano.
// Origen: supabase/migrations/ · Comando: npm run db:types
// Equivalente con la CLI de Supabase (requiere Docker o proyecto enlazado):
//   npx supabase gen types typescript --local --schema public > src/types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          company_id: string | null;
          group_id: string | null;
          id: number;
          new_data: Json | null;
          occurred_at: string;
          old_data: Json | null;
          record_id: string;
          table_name: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          company_id?: string | null;
          group_id?: string | null;
          id?: never;
          new_data?: Json | null;
          occurred_at?: string;
          old_data?: Json | null;
          record_id: string;
          table_name: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          company_id?: string | null;
          group_id?: string | null;
          id?: never;
          new_data?: Json | null;
          occurred_at?: string;
          old_data?: Json | null;
          record_id?: string;
          table_name?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          created_at: string;
          group_id: string;
          id: string;
          legal_name: string | null;
          logo_path: string | null;
          name: string;
          primary_color: string;
          slug: string;
          status: Database["public"]["Enums"]["entity_status"];
          tax_id: string | null;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          group_id: string;
          id?: string;
          legal_name?: string | null;
          logo_path?: string | null;
          name: string;
          primary_color?: string;
          slug: string;
          status?: Database["public"]["Enums"]["entity_status"];
          tax_id?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          group_id?: string;
          id?: string;
          legal_name?: string | null;
          logo_path?: string | null;
          name?: string;
          primary_color?: string;
          slug?: string;
          status?: Database["public"]["Enums"]["entity_status"];
          tax_id?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "companies_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ];
      };
      company_memberships: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          status: Database["public"]["Enums"]["membership_status"];
          updated_at: string;
          user_id: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          status?: Database["public"]["Enums"]["membership_status"];
          updated_at?: string;
          user_id: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          status?: Database["public"]["Enums"]["membership_status"];
          updated_at?: string;
          user_id?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "company_memberships_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "company_memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      employees: {
        Row: {
          company_id: string;
          created_at: string;
          employee_code: string;
          first_name: string;
          id: string;
          last_name: string;
          membership_id: string | null;
          status: Database["public"]["Enums"]["entity_status"];
          team_id: string | null;
          updated_at: string;
          work_center_id: string | null;
          work_email: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          employee_code: string;
          first_name: string;
          id?: string;
          last_name: string;
          membership_id?: string | null;
          status?: Database["public"]["Enums"]["entity_status"];
          team_id?: string | null;
          updated_at?: string;
          work_center_id?: string | null;
          work_email?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          employee_code?: string;
          first_name?: string;
          id?: string;
          last_name?: string;
          membership_id?: string | null;
          status?: Database["public"]["Enums"]["entity_status"];
          team_id?: string | null;
          updated_at?: string;
          work_center_id?: string | null;
          work_email?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employees_membership_id_company_id_fkey";
            columns: ["membership_id", "company_id"];
            isOneToOne: true;
            referencedRelation: "company_memberships";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "employees_team_id_company_id_fkey";
            columns: ["team_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "employees_work_center_id_company_id_fkey";
            columns: ["work_center_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "work_centers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      employment_terms: {
        Row: {
          company_id: string;
          contract_type: Database["public"]["Enums"]["contract_type"];
          created_at: string;
          employee_id: string;
          id: string;
          job_title: string | null;
          status: Database["public"]["Enums"]["terms_status"];
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
          weekly_hours: number;
          working_time: Database["public"]["Enums"]["working_time"];
        };
        Insert: {
          company_id: string;
          contract_type: Database["public"]["Enums"]["contract_type"];
          created_at?: string;
          employee_id: string;
          id?: string;
          job_title?: string | null;
          status?: Database["public"]["Enums"]["terms_status"];
          updated_at?: string;
          valid_from: string;
          valid_to?: string | null;
          weekly_hours: number;
          working_time?: Database["public"]["Enums"]["working_time"];
        };
        Update: {
          company_id?: string;
          contract_type?: Database["public"]["Enums"]["contract_type"];
          created_at?: string;
          employee_id?: string;
          id?: string;
          job_title?: string | null;
          status?: Database["public"]["Enums"]["terms_status"];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
          weekly_hours?: number;
          working_time?: Database["public"]["Enums"]["working_time"];
        };
        Relationships: [
          {
            foreignKeyName: "employment_terms_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employment_terms_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      group_admins: {
        Row: {
          created_at: string;
          granted_by: string | null;
          group_id: string;
          id: string;
          status: Database["public"]["Enums"]["grant_status"];
          updated_at: string;
          user_id: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          created_at?: string;
          granted_by?: string | null;
          group_id: string;
          id?: string;
          status?: Database["public"]["Enums"]["grant_status"];
          updated_at?: string;
          user_id: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          created_at?: string;
          granted_by?: string | null;
          group_id?: string;
          id?: string;
          status?: Database["public"]["Enums"]["grant_status"];
          updated_at?: string;
          user_id?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "group_admins_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_admins_group_id_fkey";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "group_admins_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      groups: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          slug: string;
          status: Database["public"]["Enums"]["entity_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
          status?: Database["public"]["Enums"]["entity_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
          status?: Database["public"]["Enums"]["entity_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      manager_assignments: {
        Row: {
          company_id: string;
          created_at: string;
          employee_id: string;
          granted_by: string | null;
          id: string;
          manager_user_id: string;
          status: Database["public"]["Enums"]["grant_status"];
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          employee_id: string;
          granted_by?: string | null;
          id?: string;
          manager_user_id: string;
          status?: Database["public"]["Enums"]["grant_status"];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          employee_id?: string;
          granted_by?: string | null;
          id?: string;
          manager_user_id?: string;
          status?: Database["public"]["Enums"]["grant_status"];
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "manager_assignments_created_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "manager_assignments_employee_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "manager_assignments_manager_user_id_fkey";
            columns: ["manager_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: { created_at: string; created_by: string | null; user_id: string };
        Insert: { created_at?: string; created_by?: string | null; user_id: string };
        Update: { created_at?: string; created_by?: string | null; user_id?: string };
        Relationships: [
          {
            foreignKeyName: "platform_admins_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_admins_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string;
          id: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      role_assignments: {
        Row: {
          company_id: string;
          created_at: string;
          granted_by: string | null;
          id: string;
          membership_id: string;
          role: Database["public"]["Enums"]["app_role"];
          scope_type: Database["public"]["Enums"]["role_scope"];
          status: Database["public"]["Enums"]["grant_status"];
          team_id: string | null;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
          work_center_id: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          membership_id: string;
          role: Database["public"]["Enums"]["app_role"];
          scope_type?: Database["public"]["Enums"]["role_scope"];
          status?: Database["public"]["Enums"]["grant_status"];
          team_id?: string | null;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
          work_center_id?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          membership_id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          scope_type?: Database["public"]["Enums"]["role_scope"];
          status?: Database["public"]["Enums"]["grant_status"];
          team_id?: string | null;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
          work_center_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "role_assignments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "role_assignments_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "role_assignments_membership_id_company_id_fkey";
            columns: ["membership_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "company_memberships";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "role_assignments_team_id_company_id_fkey";
            columns: ["team_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "role_assignments_work_center_id_company_id_fkey";
            columns: ["work_center_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "work_centers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      teams: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          name: string;
          status: Database["public"]["Enums"]["entity_status"];
          updated_at: string;
          work_center_id: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          name: string;
          status?: Database["public"]["Enums"]["entity_status"];
          updated_at?: string;
          work_center_id?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
          status?: Database["public"]["Enums"]["entity_status"];
          updated_at?: string;
          work_center_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "teams_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teams_work_center_id_company_id_fkey";
            columns: ["work_center_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "work_centers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      work_centers: {
        Row: {
          address_line: string | null;
          city: string | null;
          code: string;
          company_id: string;
          country_code: string;
          created_at: string;
          id: string;
          name: string;
          postal_code: string | null;
          province: string | null;
          status: Database["public"]["Enums"]["entity_status"];
          timezone: string;
          updated_at: string;
        };
        Insert: {
          address_line?: string | null;
          city?: string | null;
          code: string;
          company_id: string;
          country_code?: string;
          created_at?: string;
          id?: string;
          name: string;
          postal_code?: string | null;
          province?: string | null;
          status?: Database["public"]["Enums"]["entity_status"];
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          address_line?: string | null;
          city?: string | null;
          code?: string;
          company_id?: string;
          country_code?: string;
          created_at?: string;
          id?: string;
          name?: string;
          postal_code?: string | null;
          province?: string | null;
          status?: Database["public"]["Enums"]["entity_status"];
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_centers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      app_role: "company_admin" | "hr" | "manager" | "accounting" | "employee" | "auditor";
      contract_type:
        "permanent" | "temporary" | "seasonal_permanent" | "internship" | "training" | "other";
      entity_status: "active" | "inactive";
      grant_status: "active" | "revoked";
      membership_status: "invited" | "active" | "suspended" | "ended";
      role_scope: "company" | "work_center" | "team";
      terms_status: "draft" | "active" | "ended";
      working_time: "full_time" | "part_time";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
