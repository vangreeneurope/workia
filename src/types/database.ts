// ARCHIVO GENERADO. No editar a mano.
// Origen: supabase/migrations/ · Comando: npm run db:types
// Equivalente con la CLI de Supabase (requiere Docker o proyecto enlazado):
//   npx supabase gen types typescript --local --schema public > src/types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      approver_substitutions: {
        Row: {
          absent_user_id: string;
          company_id: string;
          created_at: string;
          granted_by: string | null;
          id: string;
          reason: string;
          request_type: Database["public"]["Enums"]["approval_type"];
          status: Database["public"]["Enums"]["grant_status"];
          substitute_user_id: string;
          updated_at: string;
          valid_from: string;
          valid_to: string;
        };
        Insert: {
          absent_user_id: string;
          company_id: string;
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          reason: string;
          request_type?: Database["public"]["Enums"]["approval_type"];
          status?: Database["public"]["Enums"]["grant_status"];
          substitute_user_id: string;
          updated_at?: string;
          valid_from?: string;
          valid_to: string;
        };
        Update: {
          absent_user_id?: string;
          company_id?: string;
          created_at?: string;
          granted_by?: string | null;
          id?: string;
          reason?: string;
          request_type?: Database["public"]["Enums"]["approval_type"];
          status?: Database["public"]["Enums"]["grant_status"];
          substitute_user_id?: string;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string;
        };
        Relationships: [
          {
            foreignKeyName: "approver_substitutions_absent_user_id_fkey";
            columns: ["absent_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approver_substitutions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approver_substitutions_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approver_substitutions_substitute_user_id_fkey";
            columns: ["substitute_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_events: {
        Row: {
          action: string;
          actor_id: string | null;
          after: Json | null;
          before: Json | null;
          changed_fields: string[];
          company_id: string | null;
          entity: string;
          entity_id: string | null;
          group_id: string | null;
          id: number;
          occurred_at: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          changed_fields?: string[];
          company_id?: string | null;
          entity: string;
          entity_id?: string | null;
          group_id?: string | null;
          id?: never;
          occurred_at?: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          after?: Json | null;
          before?: Json | null;
          changed_fields?: string[];
          company_id?: string | null;
          entity?: string;
          entity_id?: string | null;
          group_id?: string | null;
          id?: never;
          occurred_at?: string;
        };
        Relationships: [];
      };
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
          end_date: string | null;
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
          end_date?: string | null;
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
          end_date?: string | null;
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
      holiday_calendars: {
        Row: {
          applies_to_all_centers: boolean;
          company_id: string;
          created_at: string;
          id: string;
          locality: string | null;
          name: string;
          region_code: string | null;
          scope: Database["public"]["Enums"]["calendar_scope"];
          source_reference: string;
          status: Database["public"]["Enums"]["entity_status"];
          updated_at: string;
        };
        Insert: {
          applies_to_all_centers?: boolean;
          company_id: string;
          created_at?: string;
          id?: string;
          locality?: string | null;
          name: string;
          region_code?: string | null;
          scope: Database["public"]["Enums"]["calendar_scope"];
          source_reference: string;
          status?: Database["public"]["Enums"]["entity_status"];
          updated_at?: string;
        };
        Update: {
          applies_to_all_centers?: boolean;
          company_id?: string;
          created_at?: string;
          id?: string;
          locality?: string | null;
          name?: string;
          region_code?: string | null;
          scope?: Database["public"]["Enums"]["calendar_scope"];
          source_reference?: string;
          status?: Database["public"]["Enums"]["entity_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "holiday_calendars_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      holidays: {
        Row: {
          calendar_id: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          holiday_date: string;
          id: string;
          name: string;
          status: Database["public"]["Enums"]["entity_status"];
          updated_at: string;
        };
        Insert: {
          calendar_id: string;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          holiday_date: string;
          id?: string;
          name: string;
          status?: Database["public"]["Enums"]["entity_status"];
          updated_at?: string;
        };
        Update: {
          calendar_id?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          holiday_date?: string;
          id?: string;
          name?: string;
          status?: Database["public"]["Enums"]["entity_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "holidays_calendar_id_company_id_fkey";
            columns: ["calendar_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "holiday_calendars";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "holidays_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "holidays_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      kiosk_attempts: {
        Row: {
          company_id: string;
          created_at: string;
          device_id: string;
          employee_id: string | null;
          id: number;
          success: boolean;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          device_id: string;
          employee_id?: string | null;
          id?: never;
          success: boolean;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          device_id?: string;
          employee_id?: string | null;
          id?: never;
          success?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "kiosk_attempts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kiosk_attempts_device_id_company_id_fkey";
            columns: ["device_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "kiosk_devices";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      kiosk_devices: {
        Row: {
          blocked_until: string | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          last_used_at: string | null;
          name: string;
          status: Database["public"]["Enums"]["entity_status"];
          token_hash: string;
          updated_at: string;
          work_center_id: string;
        };
        Insert: {
          blocked_until?: string | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          last_used_at?: string | null;
          name: string;
          status?: Database["public"]["Enums"]["entity_status"];
          token_hash: string;
          updated_at?: string;
          work_center_id: string;
        };
        Update: {
          blocked_until?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          last_used_at?: string | null;
          name?: string;
          status?: Database["public"]["Enums"]["entity_status"];
          token_hash?: string;
          updated_at?: string;
          work_center_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kiosk_devices_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kiosk_devices_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kiosk_devices_work_center_id_company_id_fkey";
            columns: ["work_center_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "work_centers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      kiosk_pins: {
        Row: {
          company_id: string;
          employee_id: string;
          failed_attempts: number;
          locked_until: string | null;
          pin_hash: string | null;
          updated_at: string;
        };
        Insert: {
          company_id: string;
          employee_id: string;
          failed_attempts?: number;
          locked_until?: string | null;
          pin_hash?: string | null;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          employee_id?: string;
          failed_attempts?: number;
          locked_until?: string | null;
          pin_hash?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kiosk_pins_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "kiosk_pins_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      leave_periods: {
        Row: {
          company_id: string;
          created_at: string;
          employee_id: string;
          ends_on: string;
          id: string;
          starts_on: string;
          status: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          employee_id: string;
          ends_on: string;
          id?: string;
          starts_on: string;
          status?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          employee_id?: string;
          ends_on?: string;
          id?: string;
          starts_on?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leave_periods_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leave_periods_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      manager_assignments: {
        Row: {
          company_id: string;
          created_at: string;
          employee_id: string | null;
          granted_by: string | null;
          id: string;
          manager_user_id: string;
          request_type: Database["public"]["Enums"]["approval_type"];
          scope_type: Database["public"]["Enums"]["assignment_scope"];
          status: Database["public"]["Enums"]["grant_status"];
          team_id: string | null;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          employee_id?: string | null;
          granted_by?: string | null;
          id?: string;
          manager_user_id: string;
          request_type?: Database["public"]["Enums"]["approval_type"];
          scope_type?: Database["public"]["Enums"]["assignment_scope"];
          status?: Database["public"]["Enums"]["grant_status"];
          team_id?: string | null;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          employee_id?: string | null;
          granted_by?: string | null;
          id?: string;
          manager_user_id?: string;
          request_type?: Database["public"]["Enums"]["approval_type"];
          scope_type?: Database["public"]["Enums"]["assignment_scope"];
          status?: Database["public"]["Enums"]["grant_status"];
          team_id?: string | null;
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
          {
            foreignKeyName: "manager_assignments_team_fkey";
            columns: ["team_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "company_id"];
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
      punches: {
        Row: {
          accuracy_m: number | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          device_at: string | null;
          device_id: string | null;
          employee_id: string;
          id: string;
          idempotency_key: string;
          kind: Database["public"]["Enums"]["punch_kind"];
          kiosk_device_id: string | null;
          latitude: number | null;
          location_status: Database["public"]["Enums"]["location_status"];
          longitude: number | null;
          selfie_path: string | null;
          selfie_purged_at: string | null;
          server_at: string;
          source: Database["public"]["Enums"]["punch_source"];
          time_entry_id: string;
          time_zone: string;
        };
        Insert: {
          accuracy_m?: number | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          device_at?: string | null;
          device_id?: string | null;
          employee_id: string;
          id?: string;
          idempotency_key: string;
          kind: Database["public"]["Enums"]["punch_kind"];
          kiosk_device_id?: string | null;
          latitude?: number | null;
          location_status?: Database["public"]["Enums"]["location_status"];
          longitude?: number | null;
          selfie_path?: string | null;
          selfie_purged_at?: string | null;
          server_at?: string;
          source: Database["public"]["Enums"]["punch_source"];
          time_entry_id: string;
          time_zone: string;
        };
        Update: {
          accuracy_m?: number | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          device_at?: string | null;
          device_id?: string | null;
          employee_id?: string;
          id?: string;
          idempotency_key?: string;
          kind?: Database["public"]["Enums"]["punch_kind"];
          kiosk_device_id?: string | null;
          latitude?: number | null;
          location_status?: Database["public"]["Enums"]["location_status"];
          longitude?: number | null;
          selfie_path?: string | null;
          selfie_purged_at?: string | null;
          server_at?: string;
          source?: Database["public"]["Enums"]["punch_source"];
          time_entry_id?: string;
          time_zone?: string;
        };
        Relationships: [
          {
            foreignKeyName: "punches_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "punches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "punches_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "punches_kiosk_device_id_company_id_fkey";
            columns: ["kiosk_device_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "kiosk_devices";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "punches_time_entry_id_company_id_employee_id_fkey";
            columns: ["time_entry_id", "company_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "time_entries";
            referencedColumns: ["id", "company_id", "employee_id"];
          },
        ];
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
      schedule_events: {
        Row: {
          company_id: string;
          created_at: string;
          created_by: string | null;
          delivered_at: string | null;
          employee_id: string;
          event_type: string;
          id: number;
          payload: Json;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          delivered_at?: string | null;
          employee_id: string;
          event_type: string;
          id?: never;
          payload?: Json;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          delivered_at?: string | null;
          employee_id?: string;
          event_type?: string;
          id?: never;
          payload?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "schedule_events_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "schedule_events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "schedule_events_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      shift_assignment_days: {
        Row: {
          assignment_id: string;
          company_id: string;
          day_index: number;
          template_id: string | null;
        };
        Insert: {
          assignment_id: string;
          company_id: string;
          day_index: number;
          template_id?: string | null;
        };
        Update: {
          assignment_id?: string;
          company_id?: string;
          day_index?: number;
          template_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shift_assignment_days_assignment_id_company_id_fkey";
            columns: ["assignment_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "shift_assignments";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "shift_assignment_days_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_assignment_days_template_id_company_id_fkey";
            columns: ["template_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "shift_templates";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      shift_assignments: {
        Row: {
          anchor_date: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          cycle_days: number;
          employee_id: string | null;
          employment_terms_id: string | null;
          id: string;
          note: string | null;
          published_at: string | null;
          published_by: string | null;
          scope_type: Database["public"]["Enums"]["shift_assignment_scope"];
          status: Database["public"]["Enums"]["schedule_status"];
          team_id: string | null;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          anchor_date: string;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          cycle_days?: number;
          employee_id?: string | null;
          employment_terms_id?: string | null;
          id?: string;
          note?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          scope_type: Database["public"]["Enums"]["shift_assignment_scope"];
          status?: Database["public"]["Enums"]["schedule_status"];
          team_id?: string | null;
          updated_at?: string;
          valid_from: string;
          valid_to?: string | null;
        };
        Update: {
          anchor_date?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          cycle_days?: number;
          employee_id?: string | null;
          employment_terms_id?: string | null;
          id?: string;
          note?: string | null;
          published_at?: string | null;
          published_by?: string | null;
          scope_type?: Database["public"]["Enums"]["shift_assignment_scope"];
          status?: Database["public"]["Enums"]["schedule_status"];
          team_id?: string | null;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shift_assignments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_assignments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_assignments_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "shift_assignments_employment_terms_id_company_id_employee__fkey";
            columns: ["employment_terms_id", "company_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "employment_terms";
            referencedColumns: ["id", "company_id", "employee_id"];
          },
          {
            foreignKeyName: "shift_assignments_published_by_fkey";
            columns: ["published_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_assignments_team_id_company_id_fkey";
            columns: ["team_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      shift_template_segments: {
        Row: {
          company_id: string;
          end_minute: number;
          id: string;
          kind: Database["public"]["Enums"]["segment_kind"];
          paid: boolean;
          position: number;
          start_minute: number;
          version_id: string;
        };
        Insert: {
          company_id: string;
          end_minute: number;
          id?: string;
          kind?: Database["public"]["Enums"]["segment_kind"];
          paid?: boolean;
          position: number;
          start_minute: number;
          version_id: string;
        };
        Update: {
          company_id?: string;
          end_minute?: number;
          id?: string;
          kind?: Database["public"]["Enums"]["segment_kind"];
          paid?: boolean;
          position?: number;
          start_minute?: number;
          version_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shift_template_segments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_template_segments_version_id_company_id_fkey";
            columns: ["version_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "shift_template_versions";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      shift_template_versions: {
        Row: {
          company_id: string;
          created_at: string;
          created_by: string | null;
          flex_window_end: number | null;
          flex_window_start: number | null;
          id: string;
          kind: Database["public"]["Enums"]["shift_kind"];
          published_at: string | null;
          published_by: string | null;
          status: Database["public"]["Enums"]["schedule_status"];
          target_minutes: number;
          template_id: string;
          tolerance_early_minutes: number;
          tolerance_late_minutes: number;
          updated_at: string;
          valid_from: string | null;
          valid_to: string | null;
          version: number;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          flex_window_end?: number | null;
          flex_window_start?: number | null;
          id?: string;
          kind: Database["public"]["Enums"]["shift_kind"];
          published_at?: string | null;
          published_by?: string | null;
          status?: Database["public"]["Enums"]["schedule_status"];
          target_minutes: number;
          template_id: string;
          tolerance_early_minutes?: number;
          tolerance_late_minutes?: number;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
          version: number;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          flex_window_end?: number | null;
          flex_window_start?: number | null;
          id?: string;
          kind?: Database["public"]["Enums"]["shift_kind"];
          published_at?: string | null;
          published_by?: string | null;
          status?: Database["public"]["Enums"]["schedule_status"];
          target_minutes?: number;
          template_id?: string;
          tolerance_early_minutes?: number;
          tolerance_late_minutes?: number;
          updated_at?: string;
          valid_from?: string | null;
          valid_to?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "shift_template_versions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_template_versions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_template_versions_published_by_fkey";
            columns: ["published_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_template_versions_template_id_company_id_fkey";
            columns: ["template_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "shift_templates";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      shift_templates: {
        Row: {
          code: string;
          company_id: string;
          created_at: string;
          id: string;
          name: string;
          status: Database["public"]["Enums"]["entity_status"];
          updated_at: string;
        };
        Insert: {
          code: string;
          company_id: string;
          created_at?: string;
          id?: string;
          name: string;
          status?: Database["public"]["Enums"]["entity_status"];
          updated_at?: string;
        };
        Update: {
          code?: string;
          company_id?: string;
          created_at?: string;
          id?: string;
          name?: string;
          status?: Database["public"]["Enums"]["entity_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shift_templates_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
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
      time_adjustments: {
        Row: {
          action: Database["public"]["Enums"]["correction_action"];
          after: Json;
          before: Json;
          company_id: string;
          created_at: string;
          decided_by: string | null;
          decision: string;
          decision_note: string | null;
          effective_at: string | null;
          employee_id: string;
          id: string;
          kind: Database["public"]["Enums"]["punch_kind"] | null;
          punch_id: string | null;
          reason: string;
          request_id: string;
          requested_by: string | null;
          time_entry_id: string;
        };
        Insert: {
          action: Database["public"]["Enums"]["correction_action"];
          after: Json;
          before: Json;
          company_id: string;
          created_at?: string;
          decided_by?: string | null;
          decision?: string;
          decision_note?: string | null;
          effective_at?: string | null;
          employee_id: string;
          id?: string;
          kind?: Database["public"]["Enums"]["punch_kind"] | null;
          punch_id?: string | null;
          reason: string;
          request_id: string;
          requested_by?: string | null;
          time_entry_id: string;
        };
        Update: {
          action?: Database["public"]["Enums"]["correction_action"];
          after?: Json;
          before?: Json;
          company_id?: string;
          created_at?: string;
          decided_by?: string | null;
          decision?: string;
          decision_note?: string | null;
          effective_at?: string | null;
          employee_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["punch_kind"] | null;
          punch_id?: string | null;
          reason?: string;
          request_id?: string;
          requested_by?: string | null;
          time_entry_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_adjustments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_adjustments_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_adjustments_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "time_adjustments_punch_id_company_id_employee_id_fkey";
            columns: ["punch_id", "company_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "punches";
            referencedColumns: ["id", "company_id", "employee_id"];
          },
          {
            foreignKeyName: "time_adjustments_request_id_company_id_fkey";
            columns: ["request_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "time_correction_requests";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "time_adjustments_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_adjustments_time_entry_id_company_id_employee_id_fkey";
            columns: ["time_entry_id", "company_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "time_entries";
            referencedColumns: ["id", "company_id", "employee_id"];
          },
        ];
      };
      time_correction_requests: {
        Row: {
          action: Database["public"]["Enums"]["correction_action"];
          company_id: string;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_note: string | null;
          employee_id: string;
          id: string;
          kind: Database["public"]["Enums"]["punch_kind"] | null;
          proposed_at: string | null;
          punch_id: string | null;
          reason: string;
          requested_by: string | null;
          status: Database["public"]["Enums"]["correction_status"];
          time_entry_id: string | null;
          updated_at: string;
        };
        Insert: {
          action: Database["public"]["Enums"]["correction_action"];
          company_id: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          employee_id: string;
          id?: string;
          kind?: Database["public"]["Enums"]["punch_kind"] | null;
          proposed_at?: string | null;
          punch_id?: string | null;
          reason: string;
          requested_by?: string | null;
          status?: Database["public"]["Enums"]["correction_status"];
          time_entry_id?: string | null;
          updated_at?: string;
        };
        Update: {
          action?: Database["public"]["Enums"]["correction_action"];
          company_id?: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_note?: string | null;
          employee_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["punch_kind"] | null;
          proposed_at?: string | null;
          punch_id?: string | null;
          reason?: string;
          requested_by?: string | null;
          status?: Database["public"]["Enums"]["correction_status"];
          time_entry_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_correction_requests_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_correction_requests_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_correction_requests_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "time_correction_requests_punch_id_company_id_employee_id_fkey";
            columns: ["punch_id", "company_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "punches";
            referencedColumns: ["id", "company_id", "employee_id"];
          },
          {
            foreignKeyName: "time_correction_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_correction_requests_time_entry_id_company_id_employee_fkey";
            columns: ["time_entry_id", "company_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "time_entries";
            referencedColumns: ["id", "company_id", "employee_id"];
          },
        ];
      };
      time_entries: {
        Row: {
          break_seconds: number;
          closed_incomplete_at: string | null;
          company_id: string;
          created_at: string;
          employee_id: string;
          ended_at: string | null;
          id: string;
          recalculated_at: string;
          started_at: string | null;
          status: Database["public"]["Enums"]["time_entry_status"];
          time_zone: string;
          updated_at: string;
          work_date: string;
          worked_seconds: number;
        };
        Insert: {
          break_seconds?: number;
          closed_incomplete_at?: string | null;
          company_id: string;
          created_at?: string;
          employee_id: string;
          ended_at?: string | null;
          id?: string;
          recalculated_at?: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["time_entry_status"];
          time_zone: string;
          updated_at?: string;
          work_date: string;
          worked_seconds?: number;
        };
        Update: {
          break_seconds?: number;
          closed_incomplete_at?: string | null;
          company_id?: string;
          created_at?: string;
          employee_id?: string;
          ended_at?: string | null;
          id?: string;
          recalculated_at?: string;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["time_entry_status"];
          time_zone?: string;
          updated_at?: string;
          work_date?: string;
          worked_seconds?: number;
        };
        Relationships: [
          {
            foreignKeyName: "time_entries_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_entries_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      time_incidents: {
        Row: {
          company_id: string;
          dedupe_key: string;
          detail: Json;
          detected_at: string;
          employee_id: string;
          id: string;
          kind: Database["public"]["Enums"]["time_incident_kind"];
          punch_id: string | null;
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          status: Database["public"]["Enums"]["time_incident_status"];
          time_entry_id: string;
          updated_at: string;
          work_date: string;
        };
        Insert: {
          company_id: string;
          dedupe_key: string;
          detail?: Json;
          detected_at?: string;
          employee_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["time_incident_kind"];
          punch_id?: string | null;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database["public"]["Enums"]["time_incident_status"];
          time_entry_id: string;
          updated_at?: string;
          work_date: string;
        };
        Update: {
          company_id?: string;
          dedupe_key?: string;
          detail?: Json;
          detected_at?: string;
          employee_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["time_incident_kind"];
          punch_id?: string | null;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database["public"]["Enums"]["time_incident_status"];
          time_entry_id?: string;
          updated_at?: string;
          work_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_incidents_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_incidents_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "time_incidents_punch_id_company_id_employee_id_fkey";
            columns: ["punch_id", "company_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "punches";
            referencedColumns: ["id", "company_id", "employee_id"];
          },
          {
            foreignKeyName: "time_incidents_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_incidents_time_entry_id_company_id_employee_id_fkey";
            columns: ["time_entry_id", "company_id", "employee_id"];
            isOneToOne: false;
            referencedRelation: "time_entries";
            referencedColumns: ["id", "company_id", "employee_id"];
          },
        ];
      };
      time_tracking_policies: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          location_mode: Database["public"]["Enums"]["location_mode"];
          location_notice: string | null;
          selfie_enabled: boolean;
          updated_at: string;
          work_center_id: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          id?: string;
          location_mode?: Database["public"]["Enums"]["location_mode"];
          location_notice?: string | null;
          selfie_enabled?: boolean;
          updated_at?: string;
          work_center_id?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          location_mode?: Database["public"]["Enums"]["location_mode"];
          location_notice?: string | null;
          selfie_enabled?: boolean;
          updated_at?: string;
          work_center_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "time_tracking_policies_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_tracking_policies_work_center_id_company_id_fkey";
            columns: ["work_center_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "work_centers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      work_center_holiday_calendars: {
        Row: {
          calendar_id: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
          work_center_id: string;
        };
        Insert: {
          calendar_id: string;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          updated_at?: string;
          valid_from: string;
          valid_to?: string | null;
          work_center_id: string;
        };
        Update: {
          calendar_id?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
          work_center_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "work_center_holiday_calendars_calendar_id_company_id_fkey";
            columns: ["calendar_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "holiday_calendars";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "work_center_holiday_calendars_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_center_holiday_calendars_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_center_holiday_calendars_work_center_id_company_id_fkey";
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
      work_events: {
        Row: {
          company_id: string;
          created_at: string;
          dedupe_key: string;
          delivered_at: string | null;
          due_at: string;
          employee_id: string;
          event_type: string;
          id: number;
          payload: Json;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          dedupe_key: string;
          delivered_at?: string | null;
          due_at?: string;
          employee_id: string;
          event_type: string;
          id?: never;
          payload?: Json;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          dedupe_key?: string;
          delivered_at?: string | null;
          due_at?: string;
          employee_id?: string;
          event_type?: string;
          id?: never;
          payload?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "work_events_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "work_events_employee_id_company_id_fkey";
            columns: ["employee_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      cancel_time_correction: { Args: { p_request: string }; Returns: undefined };
      change_employment_terms: {
        Args: {
          p_employee: string;
          p_effective: string;
          p_contract_type: Database["public"]["Enums"]["contract_type"];
          p_working_time: Database["public"]["Enums"]["working_time"];
          p_weekly_hours: number;
          p_job_title?: string;
        };
        Returns: string;
      };
      close_shift_assignment: { Args: { p_id: string; p_last_day: string }; Returns: undefined };
      decide_time_correction: {
        Args: { p_request: string; p_approve: boolean; p_note?: string };
        Returns: string;
      };
      expired_punch_selfies: {
        Args: { p_limit?: number };
        Returns: { punch_id: string; selfie_path: string }[];
      };
      find_group_user_by_email: { Args: { p_company: string; p_email: string }; Returns: string };
      generate_time_reminders: { Args: { p_now?: string }; Returns: number };
      group_user_labels: {
        Args: { p_company: string; p_users: unknown };
        Returns: { user_id: string; full_name: string }[];
      };
      import_employees: { Args: { p_company: string; p_rows: Json }; Returns: number };
      kiosk_device_info: {
        Args: { p_token: string };
        Returns: { device_name: string; work_center_name: string; company_name: string }[];
      };
      kiosk_punch: {
        Args: {
          p_token: string;
          p_employee_code: string;
          p_pin: string;
          p_kind: Database["public"]["Enums"]["punch_kind"];
          p_idempotency_key: string;
          p_device_at?: string;
        };
        Returns: Json;
      };
      log_admin_event: {
        Args: {
          p_company: string;
          p_action: string;
          p_entity: string;
          p_rows: number;
          p_filters?: Json;
        };
        Returns: undefined;
      };
      mark_punch_selfie_purged: { Args: { p_punch: string }; Returns: undefined };
      my_company_permissions: {
        Args: { p_company: string };
        Returns: {
          permission: string;
          scope_type: string;
          work_center_id: string;
          team_id: string;
        }[];
      };
      my_schedule_access: {
        Args: { p_company: string };
        Returns: { action: string; scope_type: string; work_center_id: string; team_id: string }[];
      };
      my_time_access: {
        Args: { p_company: string };
        Returns: { action: string; scope_type: string; work_center_id: string; team_id: string }[];
      };
      my_time_status: {
        Args: { p_company: string };
        Returns: {
          employee_id: string;
          time_zone: string;
          entry_id: string;
          entry_status: Database["public"]["Enums"]["time_entry_status"];
          started_at: string;
          location_mode: Database["public"]["Enums"]["location_mode"];
          location_notice: string;
          selfie_enabled: boolean;
          has_kiosk_pin: boolean;
        }[];
      };
      publish_shift_assignment: {
        Args: { p_id: string; p_accept_warnings?: boolean };
        Returns: number;
      };
      publish_shift_template_version: {
        Args: { p_version: string; p_valid_from: string };
        Returns: number;
      };
      reactivate_employee: { Args: { p_employee: string }; Returns: undefined };
      record_punch: {
        Args: {
          p_company: string;
          p_kind: Database["public"]["Enums"]["punch_kind"];
          p_idempotency_key: string;
          p_source: Database["public"]["Enums"]["punch_source"];
          p_device_at?: string;
          p_device_id?: string;
          p_location_status?: Database["public"]["Enums"]["location_status"];
          p_latitude?: number;
          p_longitude?: number;
          p_accuracy_m?: number;
          p_selfie_path?: string;
        };
        Returns: Json;
      };
      register_kiosk_device: { Args: { p_work_center: string; p_name: string }; Returns: string };
      request_time_correction: {
        Args: {
          p_employee: string;
          p_action: Database["public"]["Enums"]["correction_action"];
          p_reason: string;
          p_entry?: string;
          p_punch?: string;
          p_kind?: Database["public"]["Enums"]["punch_kind"];
          p_proposed_at?: string;
        };
        Returns: string;
      };
      reset_kiosk_pin: { Args: { p_employee: string }; Returns: undefined };
      resolve_approver: {
        Args: {
          p_employee: string;
          p_type?: Database["public"]["Enums"]["approval_type"];
          p_at?: string;
        };
        Returns: {
          approver_user_id: string;
          manager_user_id: string;
          assignment_id: string;
          substitution_id: string;
        }[];
      };
      resolve_time_incident: {
        Args: {
          p_incident: string;
          p_status: Database["public"]["Enums"]["time_incident_status"];
          p_note?: string;
        };
        Returns: undefined;
      };
      save_shift_assignment: {
        Args: {
          p_scope: Database["public"]["Enums"]["shift_assignment_scope"];
          p_valid_from: string;
          p_cycle_days: number;
          p_days: unknown;
          p_id?: string;
          p_employee?: string;
          p_team?: string;
          p_terms?: string;
          p_valid_to?: string;
          p_anchor?: string;
          p_note?: string;
        };
        Returns: string;
      };
      save_shift_template_draft: {
        Args: {
          p_template: string;
          p_kind: Database["public"]["Enums"]["shift_kind"];
          p_target_minutes: number;
          p_tolerance_early: number;
          p_tolerance_late: number;
          p_segments: Json;
          p_flex_start?: number;
          p_flex_end?: number;
        };
        Returns: string;
      };
      set_my_kiosk_pin: { Args: { p_company: string; p_pin: string }; Returns: undefined };
      shift_assignment_conflicts: {
        Args: { p_assignment: string };
        Returns: {
          severity: string;
          code: string;
          employee_code: string;
          first_day: string;
          last_day: string;
          days: number;
          message: string;
        }[];
      };
      terminate_employee: { Args: { p_employee: string; p_last_day: string }; Returns: undefined };
    };
    Enums: {
      app_role: "company_admin" | "hr" | "manager" | "accounting" | "employee" | "auditor";
      approval_type: "all" | "absences" | "expenses" | "time_corrections";
      assignment_scope: "employee" | "team";
      calendar_scope: "national" | "regional" | "local" | "company";
      contract_type:
        "permanent" | "temporary" | "seasonal_permanent" | "internship" | "training" | "other";
      correction_action: "add" | "change" | "void";
      correction_status: "pending" | "approved" | "rejected" | "cancelled";
      entity_status: "active" | "inactive";
      grant_status: "active" | "revoked";
      location_mode: "off" | "optional" | "required";
      location_status: "not_requested" | "granted" | "denied" | "unavailable" | "timeout";
      membership_status: "invited" | "active" | "suspended" | "ended";
      punch_kind: "start" | "break_start" | "break_end" | "end";
      punch_source: "mobile" | "web" | "kiosk";
      role_scope: "company" | "work_center" | "team";
      schedule_status: "draft" | "published" | "revoked";
      segment_kind: "work" | "break";
      shift_assignment_scope: "exception" | "employee" | "team" | "contract";
      shift_kind: "continuous" | "split" | "night" | "flexible";
      terms_status: "draft" | "active" | "ended";
      time_entry_status: "open" | "on_break" | "closed" | "incomplete";
      time_incident_kind:
        | "start_out_of_tolerance"
        | "end_out_of_tolerance"
        | "unplanned_work"
        | "missing_end"
        | "open_entry"
        | "overlap"
        | "location_unavailable"
        | "device_time_mismatch";
      time_incident_status: "open" | "resolved" | "dismissed";
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
