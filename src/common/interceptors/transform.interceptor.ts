import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, unknown> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((res) => {
        if (res && typeof res === 'object' && 'success' in res) {
          return res;
        }
        return {
          success: true,
          data: res,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
