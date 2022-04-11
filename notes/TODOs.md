## TODOs

Evan:
- Write installments tests
  - Update LoanTerms struct.
    - Change from `collateralTokenId` to `bundleId`.
  - Implement interest rate functionality into RepaymentController.sol.
    - Change comments for LoanTerms interest.
    - Internal calc function.
    - Fix existing tests.
  - Port over (5) RepaymentController functions and (1) LoanCore function.
    - Rewrite comments in natspec
  - Two new test scripts `Installments.ts` and `InstallmentsRepay.ts`.

    🔑 For Installment tests, run `npx hardhat test test/Installments.ts` or `npx hardhat test test/InstallmentsRepay.ts`.
- Review Origination PR

Mouzayan:
- Upgradeability and dependency architecture
    - Decide - which contracts should be upgradeable? What upgradeability pattern should they use?
    - Decide - which dependencies need to get passed in constructors for each contract?
    - Decide - of those dependencies, which should be changeable by an admin? Which should be immutable and/or only changeable by upgrade?
- Review Installments PR and Origination PR

Kevin:
- Write Origination tests
- Review installments PR

Leftover:
- Native rollovers
- Custom errors
- Move compiler to 0.8.11
- Re-do natspec - move to implementation, not interfaces
- Testing with full coverage
