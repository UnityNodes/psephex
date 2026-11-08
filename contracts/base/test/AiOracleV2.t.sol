// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AiOracle} from "../src/AiOracle.sol";
import {Dispute} from "../src/Dispute.sol";
import {IAiOracle, MAX_QUESTION_BYTES} from "../src/IAiOracle.sol";

contract SkippingOracle {
    uint256 public fee;
    uint256 public lastId;

    function ask(string calldata) external payable returns (uint256) {
        lastId += 2;
        return lastId;
    }
}

contract AiOracleV2Test is Test {
    AiOracle internal aio;
    Dispute internal dispute;

    address internal owner = makeAddr("owner");
    address internal oracleSigner = makeAddr("oracleSigner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal mallory = makeAddr("mallory");

    string internal constant QUESTION = "Did the shipment arrive before 2026-11-01?";
    uint256 internal constant FEE = 0.0001 ether;
    uint256 internal constant MIN_STAKE = 0.001 ether;
    uint64 internal constant TIMEOUT = 300;

    function setUp() public {
        aio = new AiOracle(oracleSigner, owner, FEE);
        dispute = new Dispute(address(aio), TIMEOUT, MIN_STAKE);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _questionOfLength(uint256 len) internal pure returns (string memory) {
        bytes memory b = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            b[i] = "a";
        }
        return string(b);
    }

    function test_maxQuestionBytes_matchesNearContract() public view {
        assertEq(MAX_QUESTION_BYTES, 2000);
        assertEq(aio.maxQuestionBytes(), 2000);
    }

    function test_constructor_setsFeeAndEmits() public {
        vm.expectEmit(false, false, false, true);
        emit IAiOracle.FeeUpdated(0, FEE);
        AiOracle fresh = new AiOracle(oracleSigner, owner, FEE);
        assertEq(fresh.fee(), FEE);
        assertEq(aio.fee(), FEE);
    }

    function test_setFee_onlyOwnerAndEmits() public {
        vm.prank(mallory);
        vm.expectRevert(AiOracle.OnlyOwner.selector);
        aio.setFee(0);

        vm.expectEmit(false, false, false, true, address(aio));
        emit IAiOracle.FeeUpdated(FEE, 2 * FEE);
        vm.prank(owner);
        aio.setFee(2 * FEE);
        assertEq(aio.fee(), 2 * FEE);
    }

    function test_ask_belowFeeReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.InsufficientFee.selector, FEE, FEE - 1));
        aio.ask{value: FEE - 1}(QUESTION);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.InsufficientFee.selector, FEE, 0));
        aio.ask(QUESTION);
        assertEq(aio.lastId(), 0);
    }

    function test_ask_exactFeeEmitsPaidAndKeepsFunds() public {
        vm.expectEmit(true, true, false, true, address(aio));
        emit IAiOracle.Asked(1, alice, QUESTION, keccak256(bytes(QUESTION)), FEE);
        vm.prank(alice);
        uint256 id = aio.ask{value: FEE}(QUESTION);
        assertEq(id, 1);
        assertEq(address(aio).balance, FEE);
    }

    function test_ask_overpaymentIsRecordedAsPaid() public {
        vm.expectEmit(true, true, false, true, address(aio));
        emit IAiOracle.Asked(1, alice, QUESTION, keccak256(bytes(QUESTION)), 3 * FEE);
        vm.prank(alice);
        aio.ask{value: 3 * FEE}(QUESTION);
        assertEq(address(aio).balance, 3 * FEE);
    }

    function test_ask_questionAtLimitAccepted() public {
        vm.prank(alice);
        uint256 id = aio.ask{value: FEE}(_questionOfLength(MAX_QUESTION_BYTES));
        assertEq(id, 1);
    }

    function test_ask_questionOverLimitReverts() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(AiOracle.QuestionTooLong.selector, MAX_QUESTION_BYTES + 1, MAX_QUESTION_BYTES)
        );
        aio.ask{value: FEE}(_questionOfLength(MAX_QUESTION_BYTES + 1));
    }

    function test_ask_limitCountsBytesNotCharacters() public {
        string memory cyr = unicode"ї";
        assertEq(bytes(cyr).length, 2);
        bytes memory b = new bytes(MAX_QUESTION_BYTES + 2);
        for (uint256 i = 0; i < b.length; i += 2) {
            b[i] = bytes(cyr)[0];
            b[i + 1] = bytes(cyr)[1];
        }
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(AiOracle.QuestionTooLong.selector, MAX_QUESTION_BYTES + 2, MAX_QUESTION_BYTES)
        );
        aio.ask{value: FEE}(string(b));
    }

    function test_withdraw_collectsFees() public {
        vm.prank(alice);
        aio.ask{value: FEE}(QUESTION);
        vm.prank(bob);
        aio.ask{value: FEE}(QUESTION);
        uint256 before = owner.balance;
        vm.prank(owner);
        aio.withdraw(payable(owner));
        assertEq(owner.balance - before, 2 * FEE);
    }

    function test_dispute_constructorStoresMinStake() public view {
        assertEq(dispute.minStake(), MIN_STAKE);
        assertEq(address(dispute.oracle()), address(aio));
        assertEq(dispute.timeout(), TIMEOUT);
    }

    function test_dispute_forwardsFeeAndKeepsStake() public {
        uint256 stake = 1 ether;
        vm.expectEmit(true, true, false, true, address(aio));
        emit IAiOracle.Asked(1, address(dispute), QUESTION, keccak256(bytes(QUESTION)), FEE);
        vm.expectEmit(true, true, true, true, address(dispute));
        emit Dispute.DisputeOpened(1, alice, bob, stake, FEE, QUESTION);

        vm.prank(alice);
        uint256 id = dispute.openDispute{value: stake + FEE}(QUESTION, bob, FEE);

        assertEq(address(aio).balance, FEE);
        assertEq(address(dispute).balance, stake);
        assertEq(dispute.getCase(id).amount, stake);
    }

    function test_dispute_yesPaysStakeWithoutFee() public {
        uint256 stake = 1 ether;
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: stake + FEE}(QUESTION, bob, FEE);
        uint256 before = alice.balance;
        vm.prank(oracleSigner);
        aio.fulfill(id, uint8(IAiOracle.Answer.YES), keccak256(bytes(QUESTION)));
        assertEq(alice.balance - before, stake);
        assertEq(address(dispute).balance, 0);
        assertEq(address(aio).balance, FEE);
    }

    function test_dispute_refundReturnsStakeOnly() public {
        uint256 stake = 1 ether;
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: stake + FEE}(QUESTION, bob, FEE);
        vm.warp(block.timestamp + TIMEOUT);
        uint256 before = alice.balance;
        dispute.refund(id);
        assertEq(alice.balance - before, stake);
    }

    function test_dispute_belowFeeReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Dispute.InsufficientFee.selector, FEE, FEE - 1));
        dispute.openDispute{value: FEE - 1}(QUESTION, bob, FEE);
    }

    function test_dispute_feeOnlyRevertsNoStake() public {
        vm.prank(alice);
        vm.expectRevert(Dispute.NoStake.selector);
        dispute.openDispute{value: FEE}(QUESTION, bob, FEE);
    }

    function test_dispute_stakeBelowMinReverts() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Dispute.StakeTooLow.selector, MIN_STAKE - 1, MIN_STAKE));
        dispute.openDispute{value: FEE + MIN_STAKE - 1}(QUESTION, bob, FEE);
    }

    function test_dispute_stakeAtMinAccepted() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: FEE + MIN_STAKE}(QUESTION, bob, FEE);
        assertEq(dispute.getCase(id).amount, MIN_STAKE);
    }

    function test_dispute_questionOverLimitReverts() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(Dispute.QuestionTooLong.selector, MAX_QUESTION_BYTES + 1, MAX_QUESTION_BYTES)
        );
        dispute.openDispute{value: 1 ether}(_questionOfLength(MAX_QUESTION_BYTES + 1), bob, FEE);
    }

    function test_dispute_usesFeeAtOpenTime() public {
        vm.prank(owner);
        aio.setFee(2 * FEE);
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 2 * FEE);
        assertEq(dispute.getCase(id).amount, 1 ether - 2 * FEE);
        assertEq(address(aio).balance, 2 * FEE);
    }

    function test_dispute_maxFeeGuardsAgainstFeeIncrease() public {
        vm.prank(owner);
        aio.setFee(5 * FEE);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Dispute.FeeAboveMax.selector, 5 * FEE, FEE));
        dispute.openDispute{value: 1 ether}(QUESTION, bob, FEE);

        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, 5 * FEE);
        assertEq(dispute.getCase(id).amount, 1 ether - 5 * FEE);
    }

    function test_dispute_caseIdMatchesOracleRequestAcrossDirectAsks() public {
        vm.prank(bob);
        aio.ask{value: FEE}("direct");
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, FEE);
        assertEq(id, 2);
        assertEq(aio.getRequest(2).requester, address(dispute));
        assertEq(dispute.getCase(2).claimant, alice);
        assertEq(dispute.getCase(1).claimant, address(0));
    }

    function test_dispute_rejectsIdMismatchFromOracle() public {
        SkippingOracle skipping = new SkippingOracle();
        Dispute d = new Dispute(address(skipping), TIMEOUT, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Dispute.RequestIdMismatch.selector, 1, 2));
        d.openDispute{value: 1 ether}(QUESTION, bob, FEE);
        assertEq(d.getCase(1).claimant, address(0));
    }

    function test_transferOwnership_onlyOwnerAndEmits() public {
        vm.prank(mallory);
        vm.expectRevert(AiOracle.OnlyOwner.selector);
        aio.transferOwnership(mallory);

        vm.prank(owner);
        vm.expectRevert(AiOracle.ZeroAddress.selector);
        aio.transferOwnership(address(0));

        vm.expectEmit(true, true, false, false, address(aio));
        emit AiOracle.OwnershipTransferred(owner, bob);
        vm.prank(owner);
        aio.transferOwnership(bob);
        assertEq(aio.owner(), bob);
    }

    function test_setCallbackGasLimit_onlyOwnerAndEmits() public {
        vm.prank(mallory);
        vm.expectRevert(AiOracle.OnlyOwner.selector);
        aio.setCallbackGasLimit(1);

        vm.expectEmit(false, false, false, true, address(aio));
        emit IAiOracle.CallbackGasLimitUpdated(200_000, 250_000);
        vm.prank(owner);
        aio.setCallbackGasLimit(250_000);
        assertEq(aio.callbackGasLimit(), 250_000);
    }

    function test_feeCap_constructorAndSetFee() public {
        uint256 cap = aio.MAX_FEE();
        assertEq(cap, 0.01 ether);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.FeeTooHigh.selector, cap + 1, cap));
        new AiOracle(oracleSigner, owner, cap + 1);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.FeeTooHigh.selector, cap + 1, cap));
        aio.setFee(cap + 1);

        vm.prank(owner);
        aio.setFee(cap);
        assertEq(aio.fee(), cap);
    }

    function test_feeCap_boundsStakeLossFromFeeFrontRun() public {
        uint256 cap = aio.MAX_FEE();
        vm.prank(owner);
        aio.setFee(cap);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Dispute.FeeAboveMax.selector, cap, FEE));
        dispute.openDispute{value: 1 ether}(QUESTION, bob, FEE);
    }

    function test_setCallbackGasLimit_rejectsOutOfRange() public {
        uint256 lo = aio.MIN_CALLBACK_GAS_LIMIT();
        uint256 hi = aio.MAX_CALLBACK_GAS_LIMIT();
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.CallbackGasLimitOutOfRange.selector, lo - 1));
        aio.setCallbackGasLimit(lo - 1);
        vm.expectRevert(abi.encodeWithSelector(AiOracle.CallbackGasLimitOutOfRange.selector, hi + 1));
        aio.setCallbackGasLimit(hi + 1);
        aio.setCallbackGasLimit(lo);
        aio.setCallbackGasLimit(hi);
        vm.stopPrank();
        assertEq(aio.callbackGasLimit(), hi);
    }

    function test_fulfill_lowGasRevertsAndAnswerCanBeRedelivered() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, FEE);
        bytes32 h = keccak256(bytes(QUESTION));

        vm.prank(oracleSigner);
        vm.expectPartialRevert(AiOracle.InsufficientGasForCallback.selector);
        aio.fulfill{gas: 120_000}(id, 1, h);
        assertFalse(aio.getRequest(id).fulfilled);

        uint256 before = alice.balance;
        vm.prank(oracleSigner);
        aio.fulfill{gas: 280_000}(id, 1, h);
        assertTrue(dispute.getCase(id).settled);
        assertEq(alice.balance - before, 1 ether - FEE);
    }

    function test_fulfill_eoaRequesterNeedsNoCallbackGas() public {
        vm.prank(alice);
        uint256 id = aio.ask{value: FEE}(QUESTION);
        vm.prank(oracleSigner);
        aio.fulfill{gas: 60_000}(id, 1, keccak256(bytes(QUESTION)));
        assertTrue(aio.getRequest(id).fulfilled);
    }

    function test_review_feeDisputePathGasUnder300kLimit() public {
        vm.prank(alice);
        uint256 id = dispute.openDispute{value: 1 ether}(QUESTION, bob, FEE);
        uint256 callGas = 300_000 - 21_000 - 16 * 36 - 4 * 64;
        vm.prank(oracleSigner);
        uint256 before = gasleft();
        aio.fulfill{gas: callGas}(id, 1, keccak256(bytes(QUESTION)));
        emit log_named_uint("v2 fulfill+dispute callback gas used", before - gasleft());
        assertTrue(dispute.getCase(id).settled);
    }

    function testFuzz_ask_feeBoundary(uint256 paid) public {
        paid = bound(paid, 0, 1 ether);
        vm.deal(alice, paid);
        vm.prank(alice);
        if (paid < FEE) {
            vm.expectRevert(abi.encodeWithSelector(AiOracle.InsufficientFee.selector, FEE, paid));
            aio.ask{value: paid}(QUESTION);
        } else {
            uint256 id = aio.ask{value: paid}(QUESTION);
            assertEq(id, 1);
            assertEq(address(aio).balance, paid);
        }
    }

    function testFuzz_ask_lengthBoundary(uint16 len) public {
        uint256 n = bound(uint256(len), 0, MAX_QUESTION_BYTES + 50);
        vm.prank(alice);
        if (n > MAX_QUESTION_BYTES) {
            vm.expectRevert(abi.encodeWithSelector(AiOracle.QuestionTooLong.selector, n, MAX_QUESTION_BYTES));
            aio.ask{value: FEE}(_questionOfLength(n));
        } else {
            aio.ask{value: FEE}(_questionOfLength(n));
            assertEq(aio.lastId(), 1);
        }
    }

    function testFuzz_dispute_stakeSplit(uint256 value) public {
        value = bound(value, 0, 5 ether);
        vm.deal(alice, value);
        vm.prank(alice);
        if (value < FEE) {
            vm.expectRevert(abi.encodeWithSelector(Dispute.InsufficientFee.selector, FEE, value));
            dispute.openDispute{value: value}(QUESTION, bob, FEE);
        } else if (value == FEE) {
            vm.expectRevert(Dispute.NoStake.selector);
            dispute.openDispute{value: value}(QUESTION, bob, FEE);
        } else if (value - FEE < MIN_STAKE) {
            vm.expectRevert(abi.encodeWithSelector(Dispute.StakeTooLow.selector, value - FEE, MIN_STAKE));
            dispute.openDispute{value: value}(QUESTION, bob, FEE);
        } else {
            uint256 id = dispute.openDispute{value: value}(QUESTION, bob, FEE);
            assertEq(dispute.getCase(id).amount, value - FEE);
            assertEq(address(dispute).balance, value - FEE);
            assertEq(address(aio).balance, FEE);
        }
    }
}
