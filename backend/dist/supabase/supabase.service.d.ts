import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
export declare class SupabaseService {
    private config;
    private client;
    constructor(config: ConfigService);
    get db(): SupabaseClient;
}
