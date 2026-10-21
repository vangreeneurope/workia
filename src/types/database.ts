/**
 * Tipos de la base de datos.
 *
 * Escritos a mano a partir de supabase/migrations/ siguiendo el formato de
 * `supabase gen types typescript`. Cuando exista el proyecto Supabase, se
 * regeneran con:
 *
 *   npx supabase gen types typescript --project-id <id> --schema public > src/types/database.ts
 *
 * y cualquier diferencia indica que las migraciones y este archivo divergieron.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
          name: string;
          legal_name: string | null;
          tax_id: string | null;
          slug: string;
          primary_color: string;
          logo_path: string | null;
          timezone: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          legal_name?: string | null;
          tax_id?: string | null;
          slug: string;
          primary_color?: string;
          logo_path?: string | null;
          timezone?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Insert"]>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          phone: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string;
          phone?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      platform_admins: {
        Row: {
          user_id: string;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          user_id: string;
          created_at?: string;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["platform_admins"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "platform_admins_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      company_memberships: {
        Row: {
          id: string;
          company_id: string;
          user_id: string;
          roles: Database["public"]["Enums"]["company_role"][];
          job_title: string | null;
          active: boolean;
          start_date: string;
          end_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          user_id: string;
          roles?: Database["public"]["Enums"]["company_role"][];
          job_title?: string | null;
          active?: boolean;
          start_date?: string;
          end_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["company_memberships"]["Insert"]>;
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
      manager_assignments: {
        Row: {
          id: string;
          manager_user_id: string;
          employee_membership_id: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          manager_user_id: string;
          employee_membership_id: string;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["manager_assignments"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "manager_assignments_manager_user_id_fkey";
            columns: ["manager_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "manager_assignments_employee_membership_id_company_id_fkey";
            columns: ["employee_membership_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "company_memberships";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      audit_log: {
        Row: {
          id: number;
          occurred_at: string;
          actor_id: string | null;
          company_id: string | null;
          table_name: string;
          record_id: string;
          action: "INSERT" | "UPDATE" | "DELETE";
          old_data: Json | null;
          new_data: Json | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      company_role: "company_admin" | "manager" | "employee" | "accounting";
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Enums<T extends keyof Database["public"]["Enums"]> = Database["public"]["Enums"][T];
