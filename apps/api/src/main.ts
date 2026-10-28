import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api', { exclude: ['healthz'] });

  // SSE 必须关掉压缩，否则浏览器收不到增量事件
  app.getHttpAdapter().getInstance().set('etag', false);

  app.enableCors({
    origin: (process.env.APP_URL ?? '').split(','),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,             // 剥掉 DTO 未声明字段，防越权传参
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('AI 健康助手 API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  logger.log(`API ready on :${port}  (docs: /api/docs in dev)`);
}

void bootstrap();
