import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ValidationPipe } from '@nestjs/common'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.enableCors({ origin: ['http://localhost:3000', 'chrome-extension://*'] })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }))
  app.setGlobalPrefix('api')
  await app.listen(process.env.PORT ?? 4000)
  console.log(`Backend running on http://localhost:4000`)
}
bootstrap()
