import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { SupabaseModule } from './supabase/supabase.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
  ],
})
export class AppModule {}
