import { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
export declare class SupabaseAuthGuard implements CanActivate {
    private config;
    constructor(config: ConfigService);
    canActivate(context: ExecutionContext): boolean;
}
