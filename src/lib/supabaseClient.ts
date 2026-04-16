import { createClient } from '@supabase/supabase-js';

// CREDENCIALES AGUILAS PILOT - VERIFICADAS
const supabaseUrl = 'https://wftuieywphbifovuakml.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmdHVpZXl3cGhiaWZvdnVha21sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMzk0MjEsImV4cCI6MjA4ODgxNTQyMX0.9JTcdIK8DgdPlHbT5oAbrr3fhpOJ4bA6HsYwH1LfzlY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);