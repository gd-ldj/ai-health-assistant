import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Auth } from './roles.guard';

class SignUpDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}
class SignInDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}
class WechatDto {
  @IsString() code!: string;
}
class RefreshDto {
  @IsString() refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  signUp(@Body() dto: SignUpDto) {
    return this.auth.signUp(dto.email, dto.password);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: SignInDto) {
    return this.auth.signInWithPassword(dto.email, dto.password);
  }

  @Post('wechat')
  @HttpCode(200)
  wechat(@Body() dto: WechatDto) {
    return this.auth.signInWithWechat(dto.code);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Get('me')
  @Auth()
  me(@Req() req: any) {
    return req.user;
  }
}
