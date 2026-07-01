import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { ValidationPipe } from '@nestjs/common'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: true })
  // 220mb accommodates base64-encoded video uploads (see UploadVideoDto.MAX_VIDEO_BASE64_LENGTH)
  app.use(require('express').json({ limit: '220mb' }))
  app.use(require('express').urlencoded({ limit: '220mb', extended: true }))

  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  app.enableCors({
    origin: (origin, callback) => {
      if (
        !origin ||
        corsOrigins.includes(origin) ||
        /^chrome-extension:\/\//.test(origin)
      ) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }
    },
  })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.setGlobalPrefix('api')
  await app.listen(process.env.PORT ?? 4000)
  console.log(`Backend running on http://localhost:${process.env.PORT ?? 4000}`)
}
bootstrap()
