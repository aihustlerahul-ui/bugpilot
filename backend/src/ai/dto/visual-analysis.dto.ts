import { IsString, IsOptional, IsObject, IsArray, IsNumber } from 'class-validator'

export class VisualAnalysisDto {
  @IsString()
  @IsOptional()
  screenshotUrl?: string

  @IsString()
  @IsOptional()
  screenshotBase64?: string

  @IsObject()
  @IsOptional()
  elementInfo?: {
    tag?: string
    id?: string
    text?: string
    cssSelector?: string
    dimensions?: {
      x: number
      y: number
      width: number
      height: number
      top: number
      right: number
      bottom: number
      left: number
      scrollWidth?: number
      scrollHeight?: number
      clientWidth?: number
      clientHeight?: number
      offsetWidth?: number
      offsetHeight?: number
    }
    computedStyles?: {
      overflow?: string
      overflowX?: string
      overflowY?: string
      textOverflow?: string
      whiteSpace?: string
      display?: string
      position?: string
      zIndex?: string
      color?: string
      backgroundColor?: string
      fontSize?: string
      lineHeight?: string
      opacity?: string
      visibility?: string
      boxSizing?: string
      padding?: string
      margin?: string
    }
    react?: {
      componentName?: string
      source?: string
    }
  }

  @IsObject()
  @IsOptional()
  parentInfo?: {
    tag?: string
    cssSelector?: string
    dimensions?: {
      width: number
      height: number
      scrollWidth?: number
      scrollHeight?: number
      clientWidth?: number
      clientHeight?: number
    }
    computedStyles?: {
      overflow?: string
      overflowX?: string
      overflowY?: string
      position?: string
      display?: string
    }
  }

  @IsObject()
  @IsOptional()
  viewport?: {
    width: number
    height: number
    devicePixelRatio?: number
  }

  @IsString()
  @IsOptional()
  url?: string

  @IsString()
  @IsOptional()
  route?: string
}
