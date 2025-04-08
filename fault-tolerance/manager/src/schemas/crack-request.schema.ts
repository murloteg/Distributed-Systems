import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { CrackResponseStatus } from 'src/external/types/CrackResponseStatus';

export const ALLOWED_CRACK_REQUEST_STATUSES: CrackResponseStatus[] = [
  'PENDING',
  'SENDING',
  'IN_PROGRESS',
  'READY',
  'ERROR',
];

@Schema({ timestamps: true, collection: 'crack_requests' })
export class CrackRequest extends Document {
  @Prop({ required: true, unique: true, index: true })
  requestId: string;

  @Prop({ required: true })
  hash: string;

  @Prop({ required: true })
  maxLength: number;

  @Prop({
    type: String,
    required: true,
    enum: ALLOWED_CRACK_REQUEST_STATUSES,
    default: 'PENDING',
    index: true,
  })
  status: CrackResponseStatus;

  @Prop({ required: true })
  workersCount: number;

  @Prop({ required: true, default: 0 })
  partsDone: number;

  @Prop({ type: [Number], default: [] })
  partsReceived: number[];

  @Prop({ type: [String], default: [] })
  results: string[];

  createdAt: Date;
  updatedAt: Date;
}

export const CrackRequestSchema = SchemaFactory.createForClass(CrackRequest);
