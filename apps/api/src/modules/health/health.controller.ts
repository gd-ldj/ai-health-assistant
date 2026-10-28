import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { IsIn, IsInt, IsObject, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { HealthService } from './health.service';
import { Auth } from '../auth/roles.guard';

class UpsertProfileDto {
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() birth_date?: string;
  @IsOptional() height_cm?: number;
  @IsOptional() weight_kg?: number;
  @IsOptional() @IsString() blood_type?: string;
  @IsOptional() allergies?: string[];
  @IsOptional() chronic_conditions?: string[];
  @IsOptional() medications?: string[];
  @IsOptional() @IsString() note?: string;
}

class AddMetricDto {
  @IsIn(['blood_pressure', 'blood_glucose', 'heart_rate', 'weight', 'height', 'steps', 'sleep', 'water', 'mood'])
  type!: string;
  @IsObject() value!: Record<string, unknown>;
  @IsOptional() @IsString() measuredAt?: string;
  @IsOptional() @IsString() note?: string;
}

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('profile')
  @Auth()
  getProfile(@Req() req: any) {
    return this.health.getProfile(req.user.sub);
  }

  @Put('profile')
  @Auth()
  upsertProfile(@Req() req: any, @Body() dto: UpsertProfileDto) {
    return this.health.upsertProfile(req.user.sub, { ...dto } as Record<string, unknown>);
  }

  @Get('metrics')
  @Auth()
  listMetrics(
    @Req() req: any,
    @Query('type') type?: string,
    @Query('days') days?: string,
  ) {
    return this.health.listMetrics(req.user.sub, type, Number(days ?? 30));
  }

  @Post('metrics')
  @Auth()
  addMetric(@Req() req: any, @Body() dto: AddMetricDto) {
    return this.health.addMetric(req.user.sub, dto);
  }
}
