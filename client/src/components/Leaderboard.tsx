import { LEADERBOARD_SCORE, type LeaderboardDto, type LeaderboardEntryDto } from '@la-tour/shared';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { CLASS_IMAGES } from '../game/assets.ts';
import { errorMessage, formatNumber, t } from '../i18n/index.ts';
import { PixelImage } from './PixelImage.tsx';

function Row({ entry }: { entry: LeaderboardEntryDto }) {
  return (
    <tr className={entry.isMe ? 'leaderboard-me' : undefined}>
      <td className="leaderboard-rank">{entry.rank}</td>
      <td>
        {entry.username}
        {entry.isMe && <span className="muted small"> {t('leaderboard.you')}</span>}
      </td>
      <td>
        <span className="leaderboard-heroes">
          {entry.heroes.map((hero, i) => (
            <span key={i} title={t(`class.name.${hero.classId}`)}>
              <PixelImage src={CLASS_IMAGES[hero.classId]} alt="" size={24} />
              {hero.level}
            </span>
          ))}
        </span>
      </td>
      <td className="leaderboard-number">{entry.floorsCleared}</td>
      <td className="leaderboard-number">{entry.heritageCount}</td>
      <td className="leaderboard-number leaderboard-score">{formatNumber(entry.score)}</td>
    </tr>
  );
}

/** Classement des 10 meilleurs joueurs (calculé par le serveur), et la place du joueur. */
export function Leaderboard() {
  const [board, setBoard] = useState<LeaderboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLeaderboard()
      .then(setBoard)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  const w = LEADERBOARD_SCORE;
  return (
    <section className="panel leaderboard">
      <h2>{t('leaderboard.title')}</h2>
      {error && <p className="error">{error}</p>}
      {!board && !error && <p className="muted">{t('app.loading')}</p>}
      {board && (
        <>
          <table>
            <thead>
              <tr>
                <th>{t('leaderboard.rank')}</th>
                <th>{t('leaderboard.player')}</th>
                <th>{t('leaderboard.heroes')}</th>
                <th>{t('leaderboard.floors')}</th>
                <th>{t('leaderboard.heritages')}</th>
                <th>{t('leaderboard.score')}</th>
              </tr>
            </thead>
            <tbody>
              {board.top.map((entry) => (
                <Row key={entry.rank} entry={entry} />
              ))}
            </tbody>
          </table>
          {board.me && (
            <p className="leaderboard-mine">
              {t('leaderboard.myRank', {
                rank: board.me.rank,
                players: board.players,
                score: formatNumber(board.me.score),
              })}
            </p>
          )}
          <p className="muted small">
            {t('leaderboard.formula', {
              floor: w.perFloorCleared,
              heritage: formatNumber(w.perHeritage),
              level: w.perHeroLevel,
              power: w.perEquipmentPower,
              building: w.perBuildingLevel,
            })}
          </p>
        </>
      )}
    </section>
  );
}
